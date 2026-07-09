"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { isShowingOutcome, showingOutcomeLabel } from "@/lib/pipeline";
import {
  canAssignShowing,
  canConfirmShowing,
  deriveCoordinationStatus,
} from "@/lib/showing-agents";
import { sendOrgNotification } from "@/lib/notifications-server";

// Operator sets the outcome of a showing. RLS scopes everything to the org.
// attended -> advance the lead to 'showed'; the change is logged to the lead
// timeline so the pipeline history stays complete (the audit gap M3 closes).
export async function updateShowingOutcome(formData: FormData) {
  await requireCapability("manage_showings", "/dashboard/showings?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  if (!id || !isShowingOutcome(outcome)) return;

  const supabase = createClient();
  const { data: showing } = await supabase
    .from("showings")
    .update({ outcome })
    .eq("id", id)
    .select("id, lead_id, organization_id, scheduled_at")
    .maybeSingle();

  if (!showing) return;
  const s = showing as {
    lead_id: string | null;
    organization_id: string;
    scheduled_at: string | null;
  };

  if (s.lead_id) {
    // Promote the lead to 'showed' when a showing is marked attended.
    if (outcome === "attended") {
      await supabase
        .from("leads")
        .update({ status: "showed" })
        .eq("id", s.lead_id)
        .in("status", ["new", "replied", "contacted", "booked"]);
    }

    await supabase.from("messages").insert({
      organization_id: s.organization_id,
      lead_id: s.lead_id,
      channel: "note",
      direction: "outbound",
      body: `Viewing marked ${showingOutcomeLabel(outcome)}.`,
    });

    revalidatePath(`/dashboard/leads/${s.lead_id}`);
  }

  revalidatePath("/dashboard/showings");
  revalidatePath("/dashboard");
}

// Route a viewing to one of the org's showing agents (S436, multi-operator
// routing Slice 1). Gated on manage_leads: routing is a lead-agent decision
// (owner_admin + operator), NOT something a showing_helper does — a helper only
// acts on the viewings routed to them. An empty agent_id UNASSIGNS. On a real
// assignment we stamp assigned_at, log the routing to the lead timeline (so
// oversight has a trail), and fire the leasing.showing_assigned hand-off email
// to the agent. A CANCELLED viewing can't be assigned (canAssignShowing).
export async function assignShowing(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/showings?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const rawAgentId = String(formData.get("agent_id") ?? "").trim();
  if (!id) return;
  const agentId = rawAgentId === "" ? null : rawAgentId;

  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) return;

  // Read the current showing to validate state + build the note. Explicit org
  // filter (defense in depth on top of RLS): a multi-org member must never assign
  // a showing that isn't in the org they're acting as.
  const { data: showingRow } = await supabase
    .from("showings")
    .select(
      "id, outcome, scheduled_at, assigned_agent_id, lead:leads(id, name, email), property:properties(id, address)",
    )
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!showingRow) return;
  const showing = showingRow as unknown as {
    outcome: string | null;
    scheduled_at: string | null;
    assigned_agent_id: string | null;
    lead: { id: string; name: string | null; email: string | null } | null;
    property: { id: string; address: string } | null;
  };
  if (!canAssignShowing(showing.outcome)) return;

  // If assigning, the target agent must be a live (non-archived) agent in THIS
  // org - explicit org filter so an agent from another org can never be attached
  // (the DB trigger enforces this too, migration 0114).
  let agent: { id: string; name: string; email: string | null } | null = null;
  if (agentId) {
    const { data: agentRow } = await supabase
      .from("showing_agents")
      .select("id, name, email, archived")
      .eq("id", agentId)
      .eq("organization_id", org.id)
      .maybeSingle();
    if (!agentRow) return;
    const a = agentRow as { id: string; name: string; email: string | null; archived: boolean };
    if (a.archived) return;
    agent = { id: a.id, name: a.name, email: a.email };
  }

  // Guard the UPDATE itself, not just the pre-read: org scope + reject a viewing
  // that was cancelled concurrently between the read and here. If the guarded
  // update matches no row, we stop before logging or notifying.
  const { data: updated } = await supabase
    .from("showings")
    .update({
      assigned_agent_id: agentId,
      assigned_at: agentId ? new Date().toISOString() : null,
      // Any assignment change invalidates a prior confirmation: reassigning to a
      // new agent, or unassigning, means the old "confirmed with renter" no
      // longer holds, so reset the coordination state (Slice 2).
      confirmed_at: null,
      confirmed_by: null,
    })
    .eq("id", id)
    .eq("organization_id", org.id)
    .neq("outcome", "cancelled")
    .select("id, organization_id, lead_id")
    .maybeSingle();
  if (!updated) return;
  const u = updated as { organization_id: string; lead_id: string | null };

  // Log the routing to the lead timeline for oversight.
  if (u.lead_id) {
    await supabase.from("messages").insert({
      organization_id: u.organization_id,
      lead_id: u.lead_id,
      channel: "note",
      direction: "outbound",
      body: agent
        ? `Viewing assigned to ${agent.name}.`
        : "Viewing assignment cleared.",
    });
    revalidatePath(`/dashboard/leads/${u.lead_id}`);
  }

  // Fire the hand-off email to the assigned agent (best-effort; never blocks).
  if (agent) {
    const timeZone = org.booking_timezone ?? "America/Toronto";
    const showingTime = showing.scheduled_at
      ? new Date(showing.scheduled_at).toLocaleString("en-US", {
          timeZone,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        })
      : "a time to be confirmed";
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await sendOrgNotification({
      client: supabase,
      org: {
        id: org.id,
        name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
      },
      eventKey: "leasing.showing_assigned",
      // The assigned agent is the NATURAL party for this event and must ALWAYS be
      // notified, even when the org configures extra CC recipients (Codex P1b) -
      // so pass the agent as audienceEmail (always included) rather than as
      // operatorFallback (which configured recipients would override).
      audienceEmail: agent.email,
      vars: {
        org_name: org.name ?? "Your property manager",
        property_address: showing.property?.address ?? "the property",
        agent_name: agent.name,
        lead_name: showing.lead?.name || showing.lead?.email || "a renter",
        showing_time: showingTime,
        assigned_by: user?.email ?? "The lead agent",
      },
    });
  }

  revalidatePath("/dashboard/showings");
  revalidatePath("/dashboard");
}

// Mark an assigned viewing as confirmed with the renter, or clear that (Slice 2 —
// the coordination trail that answers "did the agent actually confirm?"). Gated
// on manage_leads, same as assignment. Since showing agents are account-less in
// this slice, the lead agent/operator records the confirmation when the agent
// reports back; a future tokenized agent view lets the agent self-confirm.
export async function setShowingConfirmed(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/showings?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const confirmed = String(formData.get("confirmed") ?? "") === "true";
  if (!id) return;

  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) return;

  const { data: row } = await supabase
    .from("showings")
    .select("id, outcome, assigned_agent_id, confirmed_at, lead_id, organization_id")
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!row) return;
  const s = row as {
    outcome: string | null;
    assigned_agent_id: string | null;
    confirmed_at: string | null;
    lead_id: string | null;
    organization_id: string;
  };

  const status = deriveCoordinationStatus({
    outcome: s.outcome,
    assignedAgentId: s.assigned_agent_id,
    confirmedAt: s.confirmed_at,
  });

  if (confirmed) {
    // Can only confirm a viewing that is currently assigned + awaiting confirmation.
    if (!canConfirmShowing(status)) return;
    const { data: updated } = await supabase
      .from("showings")
      .update({ confirmed_at: new Date().toISOString(), confirmed_by: "lead" })
      .eq("id", id)
      .eq("organization_id", org.id)
      .not("assigned_agent_id", "is", null)
      .is("confirmed_at", null)
      .neq("outcome", "cancelled")
      .select("id")
      .maybeSingle();
    if (!updated) return;
  } else {
    // Clearing only makes sense on a currently-confirmed viewing.
    if (status !== "confirmed") return;
    const { data: updated } = await supabase
      .from("showings")
      .update({ confirmed_at: null, confirmed_by: null })
      .eq("id", id)
      .eq("organization_id", org.id)
      .not("confirmed_at", "is", null)
      .select("id")
      .maybeSingle();
    if (!updated) return;
  }

  if (s.lead_id) {
    await supabase.from("messages").insert({
      organization_id: s.organization_id,
      lead_id: s.lead_id,
      channel: "note",
      direction: "outbound",
      body: confirmed
        ? "Viewing confirmed with the renter."
        : "Viewing confirmation cleared.",
    });
    revalidatePath(`/dashboard/leads/${s.lead_id}`);
  }

  revalidatePath("/dashboard/showings");
  revalidatePath("/dashboard");
}
