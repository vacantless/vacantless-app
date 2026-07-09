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
import { parseLocalInputToUtc, formatSlotLong } from "@/lib/booking";
import { sendShowingRescheduled } from "@/lib/email";
import { sendOrgNotification } from "@/lib/notifications-server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

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
  let agent: { id: string; name: string; email: string | null; agent_token: string } | null = null;
  if (agentId) {
    const { data: agentRow } = await supabase
      .from("showing_agents")
      .select("id, name, email, archived, agent_token")
      .eq("id", agentId)
      .eq("organization_id", org.id)
      .maybeSingle();
    if (!agentRow) return;
    const a = agentRow as {
      id: string;
      name: string;
      email: string | null;
      archived: boolean;
      agent_token: string;
    };
    if (a.archived) return;
    agent = { id: a.id, name: a.name, email: a.email, agent_token: a.agent_token };
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
        agent_url: `${APP_URL}/agent/${agent.agent_token}`,
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
      // Mirror the pure awaiting_confirmation OPEN state, not just "not cancelled"
      // (Codex S436-Slice2 P2): .neq("outcome","cancelled") misses SQL NULL rows
      // (which deriveCoordinationStatus treats as awaiting) AND would let a
      // concurrent attended/no_show slip through. Match only the open outcomes.
      .or("outcome.is.null,outcome.eq.scheduled")
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

// Operator RESCHEDULE (S442): move a still-open viewing to a new time, re-arm its
// reminders/nudges, reset any prior confirmation, and re-notify the renter (+ the
// assigned agent, if any). Gated on manage_leads, same as assign/confirm —
// rescheduling is a lead-agent coordination action. The new time is a bare
// datetime-local wall-clock string the operator means in the org's booking
// timezone; we convert it with the DST-correct pure helper (never a hand-rolled
// offset). Only a viewing whose outcome is still open (scheduled / NULL) can be
// moved — an attended/no-show/cancelled row is terminal. The renter's cancel_token
// survives, so the confirmation email's cancel link keeps working.
export async function rescheduleShowing(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/showings?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const rawWhen = String(formData.get("scheduled_at") ?? "").trim();
  if (!id || !rawWhen) return;

  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) return;
  const timeZone = org.booking_timezone ?? "America/Toronto";

  // Convert the wall-clock input to a UTC instant in the org timezone; reject a
  // malformed value or a time in the past (a viewing can't be moved to the past).
  const newInstant = parseLocalInputToUtc(rawWhen, timeZone);
  if (!newInstant) return;
  if (newInstant.getTime() <= Date.now()) return;
  const newIso = newInstant.toISOString();

  // Read the current showing (org-scoped, defense in depth on top of RLS) to
  // validate state, capture the OLD time for the timeline + notices, and gather
  // the renter/agent contact for re-notification.
  const { data: showingRow } = await supabase
    .from("showings")
    .select(
      "id, outcome, scheduled_at, assigned_agent_id, cancel_token, lead:leads(id, name, email), property:properties(id, address)",
    )
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!showingRow) return;
  const showing = showingRow as unknown as {
    outcome: string | null;
    scheduled_at: string | null;
    assigned_agent_id: string | null;
    cancel_token: string | null;
    lead: { id: string; name: string | null; email: string | null } | null;
    property: { id: string; address: string } | null;
  };
  // Only an OPEN viewing can be rescheduled (scheduled or a legacy NULL outcome).
  if (showing.outcome != null && showing.outcome !== "scheduled") return;

  // Guard the UPDATE itself: org scope + still-open outcome (reject a viewing that
  // was cancelled/closed concurrently between the read and here). Moving the time
  // re-arms every "already sent" stamp so reminders + nudges fire again for the
  // new time, and resets the confirmation — the renter agreed to the OLD time, so
  // the new slot is unconfirmed (mirrors the assignShowing reset). The agent
  // assignment + tokens are preserved: the same agent still covers the viewing.
  const { data: updated } = await supabase
    .from("showings")
    .update({
      scheduled_at: newIso,
      reminder_24h_sent_at: null,
      reminder_2h_sent_at: null,
      reminder_24h_sms_sent_at: null,
      reminder_2h_sms_sent_at: null,
      feedback_request_sent_at: null,
      outcome_nudge_sent_at: null,
      confirmation_nudge_sent_at: null,
      confirmed_at: null,
      confirmed_by: null,
    })
    .eq("id", id)
    .eq("organization_id", org.id)
    .or("outcome.is.null,outcome.eq.scheduled")
    .select("id, organization_id, lead_id")
    .maybeSingle();
  if (!updated) return;
  const u = updated as { organization_id: string; lead_id: string | null };

  const oldLabel = showing.scheduled_at
    ? formatSlotLong(showing.scheduled_at, timeZone)
    : "an earlier time";
  const newLabel = formatSlotLong(newIso, timeZone);

  // Log the reschedule to the lead timeline for oversight (the audit trail).
  if (u.lead_id) {
    await supabase.from("messages").insert({
      organization_id: u.organization_id,
      lead_id: u.lead_id,
      channel: "note",
      direction: "outbound",
      body: `Viewing rescheduled from ${oldLabel} to ${newLabel}.`,
    });
    revalidatePath(`/dashboard/leads/${u.lead_id}`);
  }

  // Re-notify the renter with the new time (best-effort; never blocks). The
  // cancel_token survives the reschedule, so the cancel link still works.
  if (showing.lead?.email) {
    await sendShowingRescheduled({
      lead_id: showing.lead.id,
      renter_name: showing.lead.name,
      renter_email: showing.lead.email,
      org_name: org.name,
      brand_color: org.brand_color,
      logo_url: org.logo_url,
      reply_to_email: org.reply_to_email,
      property_address: showing.property?.address ?? null,
      when_label: newLabel,
      old_when_label: oldLabel,
      cancel_url: showing.cancel_token
        ? `${APP_URL}/showing/cancel/${showing.cancel_token}`
        : null,
    });
  }

  // Re-notify the assigned covering agent (if any) so their hand-off stays
  // current. Fires the leasing.showing_rescheduled event with the agent as the
  // always-included recipient (audienceEmail), mirroring leasing.showing_assigned.
  if (showing.assigned_agent_id) {
    const { data: agentRow } = await supabase
      .from("showing_agents")
      .select("id, name, email, archived, agent_token")
      .eq("id", showing.assigned_agent_id)
      .eq("organization_id", org.id)
      .maybeSingle();
    const agent = agentRow as {
      name: string;
      email: string | null;
      archived: boolean;
      agent_token: string;
    } | null;
    if (agent && !agent.archived) {
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
        eventKey: "leasing.showing_rescheduled",
        audienceEmail: agent.email,
        vars: {
          org_name: org.name ?? "Your property manager",
          property_address: showing.property?.address ?? "the property",
          agent_name: agent.name,
          lead_name: showing.lead?.name || showing.lead?.email || "a renter",
          showing_time: newLabel,
          old_showing_time: oldLabel,
          rescheduled_by: user?.email ?? "The lead agent",
          agent_url: `${APP_URL}/agent/${agent.agent_token}`,
        },
      });
    }
  }

  revalidatePath("/dashboard/showings");
  revalidatePath("/dashboard");
}
