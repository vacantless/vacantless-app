// S750: moved out of app/r/[propertyId]/actions.ts so a viewing booked by
// staff from the renter's page gets the same agent routing and "viewing
// booked" alert as one the renter booked. Not a "use server" file on purpose:
// these take a showing id and use the admin client, so they must never be
// callable from the browser. Both are best-effort and never throw.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import { viewingCalendarUrl } from "@/lib/viewing-calendar-server";
import { resolveLeadNotifyEmailsPreferMemberFallback } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import {
  orgWeekWindow,
  pickAutoAssignAgent,
  productTypeForUnitType,
  normalizeProductTypes,
  type SuggestCandidate,
} from "@/lib/showing-agents";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_LEAD_NOTIFY_RECIPIENTS = 10;

// Real-time operator alert when a renter self-books a viewing (S490). This runs
// in the same success branch as autoAssignBookedShowing, but it is independent of
// auto-assign's org opt-in: every successful booking should produce one
// lead-manager alert with the booked time. Best-effort and never throws.
export async function notifyOperatorsOfViewingBooked(showingId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin) return;

    const { data: showingRow } = await admin
      .from("showings")
      .select(
        "id, organization_id, scheduled_at, lead:leads(id, name, phone), property:properties(id, address)",
      )
      .eq("id", showingId)
      .maybeSingle();
    if (!showingRow) return;
    const showing = showingRow as unknown as {
      organization_id: string;
      scheduled_at: string | null;
      lead: { id: string; name: string | null; phone: string | null } | null;
      property: { id: string; address: string | null } | null;
    };

    const { data: orgRow } = await admin
      .from("organizations")
      .select(
        "id, name, brand_color, logo_url, mail_alias, reply_to_email, public_contact_email, booking_timezone",
      )
      .eq("id", showing.organization_id)
      .maybeSingle();
    if (!orgRow) return;
    const org = orgRow as {
      id: string;
      name: string | null;
      brand_color: string | null;
      logo_url: string | null;
      reply_to_email: string | null;
      public_contact_email: string | null;
      mail_alias: string | null;
      booking_timezone: string | null;
    };

    const { data: memberRows } = await admin
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", org.id);
    const members: NotifyMember[] = [];
    for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      members.push({ role: m.role, email: u?.user?.email ?? null });
    }
    const operatorFallback = resolveLeadNotifyEmailsPreferMemberFallback(members, [
      org.reply_to_email,
      org.public_contact_email,
    ]).slice(0, MAX_LEAD_NOTIFY_RECIPIENTS);

    const timeZone = org.booking_timezone || "America/Toronto";
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
      : "(time not set)";
    const dashboardUrl = showing.lead?.id
      ? `${APP_URL}/dashboard/leads/${showing.lead.id}`
      : `${APP_URL}/dashboard/showings`;

    await sendOrgNotification({
      client: admin,
      org: {
        id: org.id,
        name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
      },
      eventKey: "leasing.viewing_booked",
      vars: {
        org_name: org.name ?? "",
        property_address: showing.property?.address ?? "(unspecified property)",
        lead_name: showing.lead?.name?.trim() || "(no name given)",
        lead_phone: showing.lead?.phone?.trim() || "(no phone)",
        showing_time: showingTime,
        dashboard_url: dashboardUrl,
        calendar_url: viewingCalendarUrl(showingId),
      },
      operatorFallback,
      action: { label: "Open the inquiry", url: dashboardUrl },
    });
  } catch {
    // Swallow — the booking is saved; the alert is best-effort.
  }
}

// Full auto-assign at booking time (S443). When the org opted in
// (organizations.auto_assign_agents), a just-booked viewing is routed to the
// load-balanced showing agent — the same pick the manual "Assign {name}" assist
// suggests — with the leasing.showing_assigned hand-off email + a timeline note,
// exactly as if a lead agent had assigned it by hand. Runs on the anon booking
// path, so it reads the roster + org (RLS-hidden from anon) via the service-role
// admin client, mirroring notifyOperatorsOfNewLead. Best-effort: it NEVER throws,
// so a routing hiccup can't turn a captured booking into an error for the renter.
// Auto-assign REFUSES an at-capacity agent (pickAutoAssignAgent), so a full
// roster (or no roster) simply leaves the viewing unassigned for manual routing.
export async function autoAssignBookedShowing(showingId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin) return; // no service key -> can't read roster; skip quietly

    // The freshly-booked showing: its org + the renter/property context the
    // hand-off email needs. Bail if it isn't a still-open, unassigned viewing
    // (idempotent — a concurrent manual assign already claimed it).
    const { data: showingRow } = await admin
      .from("showings")
      .select(
        "id, organization_id, scheduled_at, outcome, assigned_agent_id, lead:leads(id, name, email), property:properties(id, address, unit_type)",
      )
      .eq("id", showingId)
      .maybeSingle();
    if (!showingRow) return;
    const showing = showingRow as unknown as {
      organization_id: string;
      scheduled_at: string | null;
      outcome: string | null;
      assigned_agent_id: string | null;
      lead: { id: string; name: string | null; email: string | null } | null;
      property: { id: string; address: string; unit_type: string | null } | null;
    };
    if (showing.assigned_agent_id) return;
    if (showing.outcome != null && showing.outcome !== "scheduled") return;

    // Org opt-in gate (dark by default). Also pull the brand fields the hand-off
    // email uses so we don't re-read the org twice.
    const { data: orgRow } = await admin
      .from("organizations")
      .select(
        "id, name, brand_color, logo_url, mail_alias, reply_to_email, booking_timezone, auto_assign_agents",
      )
      .eq("id", showing.organization_id)
      .maybeSingle();
    if (!orgRow) return;
    const org = orgRow as {
      id: string;
      name: string | null;
      brand_color: string | null;
      logo_url: string | null;
      mail_alias: string | null;
      reply_to_email: string | null;
      booking_timezone: string | null;
      auto_assign_agents: boolean | null;
    };
    if (!org.auto_assign_agents) return;

    // Active roster.
    const { data: agentRows } = await admin
      .from("showing_agents")
      .select("id, name, tier, email, agent_token, product_types, weekly_capacity, archived")
      .eq("organization_id", org.id);
    const active = ((agentRows ?? []) as {
      id: string;
      name: string;
      tier: string | null;
      email: string | null;
      agent_token: string;
      product_types: string[] | null;
      weekly_capacity: number | null;
      archived: boolean;
    }[]).filter((a) => !a.archived);
    if (active.length === 0) return;

    // Per-agent load for the org-local week the NEW viewing falls in — NOT the
    // current week (Codex S443 P2): a renter can book up to the horizon out
    // (default 14 days), so a next-week booking must load-balance against each
    // agent's next-week assignments, or a next-week-full agent still gets routed
    // to (and a next-week-open agent gets skipped because this week is busy).
    // Anchor the window on scheduled_at; fall back to now only if it's somehow null.
    const timeZone = org.booking_timezone ?? "America/Toronto";
    const anchorMs = showing.scheduled_at
      ? new Date(showing.scheduled_at).getTime()
      : Date.now();
    const week = orgWeekWindow(anchorMs, timeZone);
    const { data: weekRows } = await admin
      .from("showings")
      .select("assigned_agent_id, scheduled_at, outcome")
      .eq("organization_id", org.id)
      .not("assigned_agent_id", "is", null);
    const assignedThisWeek = new Map<string, number>();
    for (const s of (weekRows ?? []) as {
      assigned_agent_id: string | null;
      scheduled_at: string | null;
      outcome: string | null;
    }[]) {
      if (!s.assigned_agent_id || s.outcome === "cancelled" || !s.scheduled_at) continue;
      const t = new Date(s.scheduled_at).getTime();
      if (t >= week.startMs && t < week.endMs) {
        assignedThisWeek.set(
          s.assigned_agent_id,
          (assignedThisWeek.get(s.assigned_agent_id) ?? 0) + 1,
        );
      }
    }

    const candidates: SuggestCandidate[] = active.map((a) => ({
      id: a.id,
      name: a.name,
      tier: a.tier,
      productTypes: normalizeProductTypes(a.product_types),
      weeklyCapacity: a.weekly_capacity,
      assignedThisWeek: assignedThisWeek.get(a.id) ?? 0,
      archived: false,
    }));
    // S712: route by the rental's unit type against each agent's "Handles".
    const pick = pickAutoAssignAgent(candidates, {
      productType: productTypeForUnitType(showing.property?.unit_type),
    });
    if (!pick) return; // everyone at capacity -> leave unassigned for manual routing
    const agent = active.find((a) => a.id === pick.agentId);
    if (!agent) return;

    // Guarded UPDATE: assign only if the viewing is STILL unassigned + open + in
    // this org (a concurrent manual assign between the read and here wins; we
    // never double-route). Reset confirmation defensively (a new booking is never
    // pre-confirmed) to mirror assignShowing's invariant.
    // ACCEPTED LIMITATION (Codex S443 P2-a): weekly_capacity is enforced from an
    // app-layer count taken just above, so two self-bookings landing in the same
    // sub-second window could each pick the same near-full agent and overrun the
    // cap by one. This is deliberately NOT hardened with a lock: capacity is an
    // advisory hint everywhere else (the manual assignShowing path enforces no cap
    // at all, and the suggestion chip surfaces at-capacity agents for a human to
    // override), volume is low, and the overrun is self-correcting on the next
    // booking. If capacity ever needs to be a HARD guarantee, move the pick+write
    // into a SECURITY DEFINER RPC that recounts under an advisory lock and apply
    // it to BOTH the auto and manual paths so they stay consistent.
    const { data: updated } = await admin
      .from("showings")
      .update({
        assigned_agent_id: agent.id,
        assigned_at: new Date().toISOString(),
        confirmed_at: null,
        confirmed_by: null,
      })
      .eq("id", showingId)
      .eq("organization_id", org.id)
      .is("assigned_agent_id", null)
      .or("outcome.is.null,outcome.eq.scheduled")
      .select("id, lead_id")
      .maybeSingle();
    if (!updated) return;
    const u = updated as { lead_id: string | null };

    // Log the routing to the lead timeline for oversight (labelled auto so the
    // history distinguishes it from a hand assignment).
    if (u.lead_id) {
      await admin.from("messages").insert({
        organization_id: org.id,
        lead_id: u.lead_id,
        channel: "note",
        direction: "outbound",
        body: `Viewing auto-assigned to ${agent.name}.`,
      });
    }

    // Fire the same hand-off email the manual assign sends (best-effort). The
    // assigned agent is the natural party for the event, so pass them as the
    // always-included audienceEmail (configured CCs are additive).
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
    await sendOrgNotification({
      client: admin,
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
        property_address: showing.property?.address ?? "the property",
        agent_name: agent.name,
        lead_name: showing.lead?.name || showing.lead?.email || "a renter",
        showing_time: showingTime,
        assigned_by: "Auto-assign",
        agent_url: `${APP_URL}/agent/${agent.agent_token}`,
        calendar_url: viewingCalendarUrl(showingId),
      },
    });
  } catch {
    // Swallow — the booking is saved; auto-assign is best-effort.
  }
}
