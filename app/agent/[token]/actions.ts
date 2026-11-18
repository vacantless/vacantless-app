"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import { resolveLeadNotifyEmailsPreferMemberFallback } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import { canUseRentalApplications } from "@/lib/billing";
import { startRentalApplication } from "@/lib/rental-application-server";

// Public, UNAUTHENTICATED agent self-confirm (showing routing Slice 3). The
// covering agent opens their /agent/[token] shared calendar from the hand-off /
// nudge email; they have NO Vacantless session — the per-agent token in the URL
// is the only handle. Confirming is a POST server action, never a GET side-effect:
// email link scanners (Outlook SafeLinks, Gmail prefetch) fetch GET URLs, so a GET
// that confirmed would auto-confirm on scan (KI585). The write goes through the
// SECURITY DEFINER confirm_showing_from_token RPC, which re-derives the agent +
// org from the token and confirms ONLY a showing actually assigned to that agent.
// The anon client can call it because the function is granted to anon and is the
// source of truth — a wrong token confirms nothing.

function path(token: string, status: string): string {
  return `/agent/${encodeURIComponent(token)}?status=${status}`;
}

export async function confirmShowingFromToken(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const showingId = String(formData.get("showing_id") ?? "").trim();
  if (!token || !showingId) redirect("/agent/invalid?status=invalid");

  const supabase = createClient();
  const { data, error } = await supabase.rpc("confirm_showing_from_token", {
    p_agent_token: token,
    p_showing_id: showingId,
  });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) {
    redirect(path(token, result?.reason === "not_found" ? "invalid" : "error"));
  }
  redirect(path(token, "confirmed"));
}

// Record what actually HAPPENED, once the viewing time has passed — the one-tap
// outcome capture at the person who was on-site (S445). Same POST-not-GET rule as
// confirm (KI585) and the same SECURITY DEFINER token pattern: the RPC re-derives
// the agent + org from the token and records ONLY a viewing assigned to that
// agent, accepting only 'attended' / 'no_show'. A wrong token records nothing.
export async function recordOutcomeFromToken(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const showingId = String(formData.get("showing_id") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "").trim();
  if (!token || !showingId) redirect("/agent/invalid?status=invalid");
  // Only the two on-site realities; anything else bounces without a DB call.
  if (outcome !== "attended" && outcome !== "no_show") {
    redirect(path(token, "error"));
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc(
    "record_showing_outcome_from_agent_token",
    { p_agent_token: token, p_showing_id: showingId, p_outcome: outcome },
  );
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) {
    redirect(path(token, result?.reason === "not_found" ? "invalid" : "error"));
  }
  // S816: after "Renter showed", the agent can send the application right there.
  if (outcome === "attended") {
    redirect(`${path(token, "recorded_attended")}&showing=${encodeURIComponent(showingId)}`);
  }
  redirect(path(token, "recorded_no_show"));
}

// S729: "Can't make it". The agent hands an upcoming viewing back. The
// SECURITY DEFINER release_showing_from_agent_token RPC (migration 0255)
// unassigns it (time kept, renter NOT contacted, an agent's own confirmation
// cleared) and notes the renter's timeline; then the leasing team is emailed
// (leasing.agent_cant_make_it) so someone covers it or moves it. POST only,
// same as Confirm (KI585).
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_NOTIFY_RECIPIENTS = 10;

type ReleaseResult = {
  ok?: boolean;
  reason?: string;
  agent_name?: string;
  organization_id?: string;
  lead_id?: string | null;
  property_id?: string | null;
  scheduled_at?: string | null;
};

function fmtWhen(iso: string | null | undefined, tz: string): string {
  if (!iso) return "time not set";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

async function notifyCantMakeIt(r: ReleaseResult): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin || !r.organization_id) return;
    const { data: org } = await admin
      .from("organizations")
      .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email, booking_timezone")
      .eq("id", r.organization_id)
      .maybeSingle();
    if (!org) return;
    const [{ data: lead }, { data: property }] = await Promise.all([
      r.lead_id
        ? admin.from("leads").select("name").eq("id", r.lead_id).maybeSingle()
        : Promise.resolve({ data: null }),
      r.property_id
        ? admin.from("properties").select("address").eq("id", r.property_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
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
    ]).slice(0, MAX_NOTIFY_RECIPIENTS);
    const dashboardUrl = `${APP_URL}/dashboard/showings`;
    await sendOrgNotification({
      client: admin,
      org: {
        id: org.id,
        name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
      },
      eventKey: "leasing.agent_cant_make_it",
      vars: {
        org_name: org.name ?? "",
        property_address:
          (property as { address?: string | null } | null)?.address?.trim() || "your rental",
        lead_name: (lead as { name?: string | null } | null)?.name?.trim() || "a renter",
        agent_name: r.agent_name?.trim() || "Your showing agent",
        showing_time: fmtWhen(r.scheduled_at, org.booking_timezone || "America/Toronto"),
        dashboard_url: dashboardUrl,
      },
      operatorFallback,
      action: { label: "Open your viewings", url: dashboardUrl },
    });
  } catch {
    // Best-effort: the hand-back is already saved and shows on the Viewings page.
  }
}

export async function releaseShowingFromToken(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const showingId = String(formData.get("showing_id") ?? "").trim();
  if (!token || !showingId) redirect("/agent/invalid?status=invalid");

  const supabase = createClient();
  const { data, error } = await supabase.rpc("release_showing_from_agent_token", {
    p_agent_token: token,
    p_showing_id: showingId,
  });
  const result = data as ReleaseResult | null;
  if (error || !result?.ok) {
    // not_found: already handed back (a double tap) or no longer theirs.
    // past: the viewing time has passed; mark how it went instead.
    const r = result?.reason;
    redirect(path(token, r === "not_found" ? "gone" : r === "past" ? "past" : "error"));
  }
  await notifyCantMakeIt(result);
  redirect(path(token, "released"));
}


// S816: the covering agent sends the rental application from the doorstep.
// Re-derives the agent and org from the token, and only for a viewing assigned
// to this agent that they marked as attended. Uses the shared starter, so the
// renter gets the same email and the renter page shows who sent it.
export async function sendApplicationFromToken(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const showingId = String(formData.get("showing_id") ?? "").trim();
  if (!token || !showingId) redirect("/agent/invalid?status=invalid");
  const admin = createAdminClient();
  if (!admin) redirect(path(token, "error"));

  const { data: agentRow } = await admin!
    .from("showing_agents")
    .select("id, name, archived, organization_id")
    .eq("agent_token", token)
    .maybeSingle();
  const agent = agentRow as { id: string; name: string; archived: boolean; organization_id: string } | null;
  if (!agent || agent.archived) redirect(path(token, "invalid"));

  const { data: showingRow } = await admin!
    .from("showings")
    .select("id, outcome, lead:leads(id, name, email, phone, property_id, property:properties(address))")
    .eq("id", showingId)
    .eq("assigned_agent_id", agent!.id)
    .eq("organization_id", agent!.organization_id)
    .maybeSingle();
  const showing = showingRow as unknown as {
    outcome: string | null;
    lead: {
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      property_id: string | null;
      property: { address: string | null } | null;
    } | null;
  } | null;
  if (!showing?.lead || showing.outcome !== "attended") redirect(path(token, "error"));

  const { data: orgRow } = await admin!
    .from("organizations")
    .select("id, name, plan, brand_color, logo_url, mail_alias, reply_to_email")
    .eq("id", agent!.organization_id)
    .maybeSingle();
  const org = orgRow as {
    id: string;
    name: string | null;
    plan: string | null;
    brand_color: string | null;
    logo_url: string | null;
    mail_alias: string | null;
    reply_to_email: string | null;
  } | null;
  if (!org || !canUseRentalApplications(org.plan)) redirect(path(token, "app_unavailable"));

  const lead = showing!.lead!;
  const res = await startRentalApplication(admin!, {
    org: org!,
    leadId: lead.id,
    propertyId: lead.property_id,
    propertyAddress: lead.property?.address ?? null,
    applicant: { name: lead.name, email: lead.email, phone: lead.phone },
    sentByAgentId: agent!.id,
    sentByLabel: `${agent!.name} (showing agent)`,
  });
  if (!res.ok) redirect(path(token, res.reason === "exists" ? "app_exists" : "app_failed"));
  redirect(path(token, res.emailed ? "app_sent" : "app_made"));
}
