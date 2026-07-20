"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { isShowingOutcome, showingOutcomeLabel } from "@/lib/pipeline";
import {
  canAssignShowing,
  canConfirmShowing,
  deriveCoordinationStatus,
  normalizeProductTypes,
  planBulkAssignments,
} from "@/lib/showing-agents";
import {
  parseLocalInputToUtc,
  formatSlotLong,
  isValidSlot,
  type Availability,
  type ClusterCandidate,
} from "@/lib/booking";
import {
  sendShowingReminder,
  sendShowingRescheduled,
  sendRescheduleProposal,
} from "@/lib/email";
import { normalizeProposedSlots } from "@/lib/reschedule-proposals";
import { sendOrgNotification } from "@/lib/notifications-server";
import { resolveArrivalPhone } from "@/lib/showing-contact";
import { releaseUnconfirmedShowing } from "@/lib/showing-release";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return (rel as T) ?? null;
}

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

// Operator-proposed reschedule (S497): unlike the unilateral reschedule above,
// this leaves the showing at its current time and emails the renter a tokenized
// pick-one link. The renter write is POST-only through accept_reschedule_proposal.
export async function proposeShowingTimes(formData: FormData) {
  await requireCapability("manage_showings", "/dashboard/showings?forbidden=1");
  const id = String(formData.get("showing_id") ?? "").trim();
  const slots = normalizeProposedSlots(formData.getAll("slot"));
  if (!id || slots.length === 0) redirect("/dashboard/showings?proposal=invalid");

  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) return;
  const timeZone = org.booking_timezone ?? "America/Toronto";

  const { data: showingRow } = await supabase
    .from("showings")
    .select(
      "id, outcome, scheduled_at, organization_id, lead:leads(id, name, email), property:properties(id, address)",
    )
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!showingRow) redirect("/dashboard/showings?proposal=invalid");
  const showing = showingRow as unknown as {
    id: string;
    outcome: string | null;
    scheduled_at: string | null;
    organization_id: string;
    lead: { id: string; name: string | null; email: string | null } | null;
    property: { id: string; address: string | null } | null;
  };
  if (showing.outcome != null && showing.outcome !== "scheduled") {
    redirect("/dashboard/showings?proposal=closed");
  }
  if (!showing.property?.id) redirect("/dashboard/showings?proposal=invalid");

  const { data: avData } = await supabase.rpc("get_public_availability", {
    p_property_id: showing.property.id,
  });
  const av = avData as Availability | null;
  if (!av) redirect("/dashboard/showings?proposal=taken");

  const validationNow = new Date();
  const { data: clusterRows, error: clusterErr } = await supabase
    .from("showings")
    .select("id, scheduled_at, property:properties(address, status)")
    .eq("organization_id", org.id)
    .eq("outcome", "scheduled")
    .gte("scheduled_at", validationNow.toISOString());
  if (clusterErr) redirect("/dashboard/showings?proposal=error");
  const clusterCandidates = ((clusterRows ?? []) as unknown as Array<{
    id: string;
    scheduled_at: string | null;
    property: { address: string | null; status: string | null } | null;
  }>).flatMap((row): ClusterCandidate[] => {
    if (!row.scheduled_at || row.property?.status === "off_market") return [];
    return [{
      id: row.id,
      address: row.property?.address ?? null,
      scheduled_at: row.scheduled_at,
    }];
  });
  const moveAvailability: Availability = {
    ...av,
    cluster_candidates: clusterCandidates,
  };
  if (
    slots.some((slot) =>
      !isValidSlot(moveAvailability, slot, validationNow, {
        excludeShowingId: showing.id,
        relaxLeadForAnchoredDays: true,
      }),
    )
  ) {
    redirect("/dashboard/showings?proposal=taken");
  }

  const now = new Date().toISOString();
  await supabase
    .from("showing_reschedule_proposals")
    .update({ status: "expired", responded_at: now })
    .eq("showing_id", showing.id)
    .eq("organization_id", org.id)
    .eq("status", "pending");

  const { data: proposal, error: proposalErr } = await supabase
    .from("showing_reschedule_proposals")
    .insert({
      showing_id: showing.id,
      organization_id: org.id,
      proposed_slots: slots,
    })
    .select("id, token")
    .single();
  if (proposalErr || !proposal?.token) {
    redirect("/dashboard/showings?proposal=error");
  }

  const labels = slots.map((slot) => formatSlotLong(slot, timeZone));
  if (showing.lead?.id) {
    await supabase.from("messages").insert({
      organization_id: org.id,
      lead_id: showing.lead.id,
      channel: "note",
      direction: "outbound",
      body: `Suggested new viewing times: ${labels.join("; ")}.`,
    });
    revalidatePath(`/dashboard/leads/${showing.lead.id}`);
  }

  await sendRescheduleProposal({
    lead_id: showing.lead?.id ?? "",
    renter_name: showing.lead?.name ?? null,
    renter_email: showing.lead?.email ?? null,
    org_name: org.name,
    brand_color: org.brand_color,
    logo_url: org.logo_url,
    reply_to_email: org.reply_to_email,
    property_address: showing.property.address ?? null,
    current_when_label: showing.scheduled_at
      ? formatSlotLong(showing.scheduled_at, timeZone)
      : null,
    proposed_when_labels: labels,
    proposal_url: `${APP_URL}/showing/reschedule/${proposal.token}`,
    renter_url: `${APP_URL}/r/${showing.property.id}`,
  });

  revalidatePath("/dashboard/showings");
  revalidatePath("/dashboard");
  redirect("/dashboard/showings?proposal=sent");
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

// Bulk "Assign all unassigned" (S444): route EVERY still-open upcoming viewing
// that has no agent yet, in one operator click, through the same load-balanced,
// capacity-respecting pick as per-booking auto-assign. Gated on manage_leads like
// the single assign — it's the same lead-agent decision, just batched, and posts
// to a guarded UPDATE per row so it adds NO new write path or privilege. The batch
// balancing (each pick counts against the next, per org-local week) lives in the
// pure planBulkAssignments; here we only load inputs, execute the plan, log, and
// notify. Redirects back with an ?assigned / ?full summary the page surfaces.
export async function assignAllUnassigned() {
  await requireCapability("manage_leads", "/dashboard/showings?forbidden=1");

  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) return;
  const timeZone = org.booking_timezone ?? "America/Toronto";
  const nowIso = new Date().toISOString();

  // Every still-open UPCOMING viewing with no agent (org-scoped, defense in depth
  // on top of RLS). `.gte("scheduled_at", now)` also drops null-time rows, which
  // can't be week-bucketed for capacity anyway.
  const { data: unassignedRows } = await supabase
    .from("showings")
    .select(
      "id, scheduled_at, lead:leads(id, name, email), property:properties(id, address)",
    )
    .eq("organization_id", org.id)
    .is("assigned_agent_id", null)
    .gte("scheduled_at", nowIso)
    .or("outcome.is.null,outcome.eq.scheduled")
    .order("scheduled_at", { ascending: true });
  const unassigned = (unassignedRows ?? []) as unknown as {
    id: string;
    scheduled_at: string | null;
    lead: { id: string; name: string | null; email: string | null } | null;
    property: { id: string; address: string } | null;
  }[];
  if (unassigned.length === 0) {
    redirect("/dashboard/showings?assigned=0");
  }

  // Active roster (non-archived).
  const { data: agentRows } = await supabase
    .from("showing_agents")
    .select(
      "id, name, tier, email, agent_token, product_types, weekly_capacity, archived",
    )
    .eq("organization_id", org.id);
  const agents = (agentRows ?? []) as {
    id: string;
    name: string;
    tier: string | null;
    email: string | null;
    agent_token: string;
    product_types: string[] | null;
    weekly_capacity: number | null;
    archived: boolean;
  }[];

  // Existing non-cancelled assignments -> the per-(agent, week) load the planner
  // balances on top of (mirrors the Viewings page + autoAssignBookedShowing).
  const { data: assignedRows } = await supabase
    .from("showings")
    .select("assigned_agent_id, scheduled_at, outcome")
    .eq("organization_id", org.id)
    .not("assigned_agent_id", "is", null);
  const existing = ((assignedRows ?? []) as {
    assigned_agent_id: string | null;
    scheduled_at: string | null;
    outcome: string | null;
  }[])
    .filter((s) => s.assigned_agent_id && s.outcome !== "cancelled" && s.scheduled_at)
    .map((s) => ({
      agentId: s.assigned_agent_id as string,
      scheduledAtMs: new Date(s.scheduled_at as string).getTime(),
    }));

  // No property product-type column yet, so every agent is a generalist (the
  // planner passes no productType) — wiring lights up when properties gain a type.
  const plan = planBulkAssignments({
    unassigned: unassigned.map((s) => ({
      id: s.id,
      scheduledAtMs: s.scheduled_at ? new Date(s.scheduled_at).getTime() : null,
    })),
    existing,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      tier: a.tier,
      productTypes: normalizeProductTypes(a.product_types),
      weeklyCapacity: a.weekly_capacity,
      archived: a.archived,
    })),
    tz: timeZone,
  });

  // Execute the plan. A guarded UPDATE per row assigns ONLY if the viewing is still
  // unassigned + open + in this org, so a concurrent manual assign between the read
  // and here wins and we never double-route (idempotent). Collect timeline notes +
  // email jobs for the rows we actually claimed.
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const viewingById = new Map(unassigned.map((s) => [s.id, s]));
  const noteRows: {
    organization_id: string;
    lead_id: string;
    channel: string;
    direction: string;
    body: string;
  }[] = [];
  const emailJobs: { agentId: string; showingId: string }[] = [];
  let assignedCount = 0;

  for (const a of plan.assignments) {
    const { data: updated } = await supabase
      .from("showings")
      .update({
        assigned_agent_id: a.agentId,
        assigned_at: new Date().toISOString(),
        // A fresh assignment is never pre-confirmed (mirrors assignShowing).
        confirmed_at: null,
        confirmed_by: null,
      })
      .eq("id", a.showingId)
      .eq("organization_id", org.id)
      .is("assigned_agent_id", null)
      .or("outcome.is.null,outcome.eq.scheduled")
      .select("id, lead_id")
      .maybeSingle();
    if (!updated) continue; // a concurrent manual assign won; skip silently.
    assignedCount++;
    const u = updated as { lead_id: string | null };
    if (u.lead_id) {
      noteRows.push({
        organization_id: org.id,
        lead_id: u.lead_id,
        channel: "note",
        direction: "outbound",
        body: `Viewing assigned to ${a.agentName}.`,
      });
    }
    emailJobs.push({ agentId: a.agentId, showingId: a.showingId });
  }

  // One batched timeline-note insert for the whole run.
  if (noteRows.length > 0) {
    await supabase.from("messages").insert(noteRows);
  }

  // Hand-off emails: the SAME leasing.showing_assigned event the manual/auto path
  // fires, one per newly-assigned viewing, sent concurrently (best-effort — a mail
  // hiccup never unwinds an assignment). Net email volume equals assigning each by
  // hand, just collapsed into one click.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await Promise.allSettled(
    emailJobs.map((job) => {
      const agent = agentById.get(job.agentId);
      const viewing = viewingById.get(job.showingId);
      if (!agent) return Promise.resolve();
      const showingTime = viewing?.scheduled_at
        ? new Date(viewing.scheduled_at).toLocaleString("en-US", {
            timeZone,
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          })
        : "a time to be confirmed";
      return sendOrgNotification({
        client: supabase,
        org: {
          id: org.id,
          name: org.name,
          brand_color: org.brand_color,
          logo_url: org.logo_url,
          reply_to_email: org.reply_to_email,
        },
        eventKey: "leasing.showing_assigned",
        audienceEmail: agent.email,
        vars: {
          org_name: org.name ?? "Your property manager",
          property_address: viewing?.property?.address ?? "the property",
          agent_name: agent.name,
          lead_name: viewing?.lead?.name || viewing?.lead?.email || "a renter",
          showing_time: showingTime,
          assigned_by: user?.email ?? "The lead agent",
          agent_url: `${APP_URL}/agent/${agent.agent_token}`,
        },
      });
    }),
  );

  // Revalidate the surfaces the assignments touched, then land back with a summary:
  // how many we assigned, and how many were left for manual routing because every
  // agent was at capacity for that viewing's week (plan.skipped).
  for (const row of noteRows) {
    revalidatePath(`/dashboard/leads/${row.lead_id}`);
  }
  revalidatePath("/dashboard/showings");
  revalidatePath("/dashboard");

  const capacitySkipped = plan.skipped.length;
  redirect(
    `/dashboard/showings?assigned=${assignedCount}${
      capacitySkipped > 0 ? `&full=${capacitySkipped}` : ""
    }`,
  );
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
      .update({ confirmed_at: new Date().toISOString(), confirmed_by: "agent" })
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

function showingIdFrom(input: FormData | string): string {
  if (typeof input === "string") return input.trim();
  return String(input.get("id") ?? "").trim();
}

export async function confirmShowingByOperator(input: FormData | string) {
  await requireCapability("manage_leads", "/dashboard/showings?forbidden=1");
  const id = showingIdFrom(input);
  if (!id) return;

  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) return;

  const { data: updated } = await supabase
    .from("showings")
    .update({ confirmed_at: new Date().toISOString(), confirmed_by: "agent" })
    .eq("id", id)
    .eq("organization_id", org.id)
    .eq("outcome", "scheduled")
    .is("confirmed_at", null)
    .select("id, organization_id, lead_id")
    .maybeSingle();
  if (!updated) return;
  const u = updated as { organization_id: string; lead_id: string | null };

  if (u.lead_id) {
    await supabase.from("messages").insert({
      organization_id: u.organization_id,
      lead_id: u.lead_id,
      channel: "note",
      direction: "outbound",
      body: "Viewing confirmed by the operator.",
    });
    revalidatePath(`/dashboard/leads/${u.lead_id}`);
  }

  revalidatePath("/dashboard/showings");
  revalidatePath("/dashboard");
}

export async function nudgeRenterForConfirmation(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/showings?forbidden=1");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org || org.showing_confirm_mode !== "agent") return;

  const { data: row } = await supabase
    .from("showings")
    .select(
      "id, cancel_token, scheduled_at, outcome, confirmed_at, lead_id, " +
        "lead:leads(id, name, email), property:properties(id, address, showing_arrival_phone)",
    )
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!row) return;
  const showing = row as unknown as {
    id: string;
    cancel_token: string | null;
    scheduled_at: string | null;
    outcome: string | null;
    confirmed_at: string | null;
    lead_id: string | null;
    lead: { id: string; name: string | null; email: string | null } | null;
    property: {
      id: string;
      address: string | null;
      showing_arrival_phone: string | null;
    } | null;
  };
  if (
    showing.outcome !== "scheduled" ||
    showing.confirmed_at != null ||
    !showing.scheduled_at ||
    new Date(showing.scheduled_at).getTime() <= Date.now()
  ) {
    return;
  }

  const lead = one(showing.lead);
  const property = one(showing.property);
  const scheduledAtMs = new Date(showing.scheduled_at).getTime();
  const hoursUntil = (scheduledAtMs - Date.now()) / 3_600_000;
  const result = await sendShowingReminder({
    lead_id: lead?.id ?? showing.lead_id ?? "",
    showing_id: showing.id,
    kind: hoursUntil <= 4 ? "sameday" : "24h",
    renter_name: lead?.name ?? null,
    renter_email: lead?.email ?? null,
    org_name: org.name,
    brand_color: org.brand_color,
    logo_url: org.logo_url,
    reply_to_email: org.reply_to_email,
    property_address: property?.address ?? null,
    leasing_phone: resolveArrivalPhone(
      property?.showing_arrival_phone,
      org.showing_arrival_phone,
      org.public_contact_phone,
    ),
    cancel_token: showing.cancel_token ?? null,
    when_label: formatSlotLong(showing.scheduled_at, org.booking_timezone ?? "America/Toronto"),
  });

  if (result.sent && showing.lead_id) {
    await supabase.from("messages").insert({
      organization_id: org.id,
      lead_id: showing.lead_id,
      channel: "email",
      direction: "outbound",
      body: "Operator sent a renter confirmation nudge.",
    });
    revalidatePath(`/dashboard/leads/${showing.lead_id}`);
  }

  revalidatePath("/dashboard/showings");
  revalidatePath("/dashboard");
}

export async function releaseUnconfirmedShowingByOperator(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/showings?forbidden=1");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org || org.showing_confirm_mode !== "agent") return;

  const result = await releaseUnconfirmedShowing(supabase, {
    org,
    showingId: id,
    appUrl: APP_URL,
    noteBody: "Viewing released by the operator because it was still unconfirmed.",
  });
  if (!result.released) return;

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
    // Return the POST-update assignment (Codex S442 P2): the pre-read
    // assigned_agent_id can be stale if another operator reassigned/unassigned
    // between the read and here. The guarded UPDATE reads+writes atomically, so
    // its RETURNING value is the authoritative current agent — notify off THAT,
    // never the pre-read, or the old agent gets the email and the new one doesn't.
    .select("id, organization_id, lead_id, assigned_agent_id")
    .maybeSingle();
  if (!updated) return;
  const u = updated as {
    organization_id: string;
    lead_id: string | null;
    assigned_agent_id: string | null;
  };

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
  if (u.assigned_agent_id) {
    const { data: agentRow } = await supabase
      .from("showing_agents")
      .select("id, name, email, archived, agent_token")
      .eq("id", u.assigned_agent_id)
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
