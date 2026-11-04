// S717: tell the landlord when a renter texts back or calls the texting
// number. Reads the org, its members and the renter with the admin client,
// then sends leasing.renter_text_reply through sendOrgNotification (so the
// landlord can turn it off or change who gets it in Messages & reminders).
// Never throws.

import { getUserByIdCached } from "./auth-email-cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendOrgNotification } from "./notifications-server";
import { resolveLeadNotifyEmailsPreferMemberFallback } from "./leads-notify";
import type { NotifyMember } from "./incident-reports";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";
const MAX_RECIPIENTS = 10;

export async function notifyOperatorsOfTextReply(
  admin: SupabaseClient,
  opts: { orgId: string; leadId: string; replyText: string; confirmedViewing?: boolean },
): Promise<void> {
  try {
    const { data: org } = await admin
      .from("organizations")
      .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email")
      .eq("id", opts.orgId)
      .maybeSingle();
    if (!org) return;
    const o = org as {
      id: string;
      name: string | null;
      brand_color: string | null;
      logo_url: string | null;
      reply_to_email: string | null;
      public_contact_email: string | null;
    };

    const { data: memberRows } = await admin
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", opts.orgId);
    const members: NotifyMember[] = [];
    for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
      const { data: u } = await getUserByIdCached(admin, m.user_id);
      members.push({ role: m.role, email: u?.user?.email ?? null });
    }
    // S750: with nobody set for "Renter texted back", use the account's
    // new-inquiry recipients (the leasing team), not just the owner login.
    const { data: newLeadSetting } = await admin
      .from("notification_settings")
      .select("recipients")
      .eq("organization_id", opts.orgId)
      .eq("event_key", "leasing.new_lead")
      .maybeSingle();
    const newLeadRecipients = (((newLeadSetting as { recipients: string[] | null } | null)?.recipients) ?? [])
      .map((e) => e.trim())
      .filter(Boolean);
    const operatorFallback = (
      newLeadRecipients.length > 0
        ? newLeadRecipients
        : resolveLeadNotifyEmailsPreferMemberFallback(members, [o.reply_to_email, o.public_contact_email])
    ).slice(0, MAX_RECIPIENTS);

    // S750 (Noam: "the showing agent needs the update more than i do"): the
    // agent assigned to this renter's next viewing always gets the reply.
    const agentEmail = await nextViewingAgentEmail(admin, opts.orgId, opts.leadId);

    const { data: leadData } = await admin
      .from("leads")
      .select("name, phone, property:properties(address)")
      .eq("id", opts.leadId)
      .maybeSingle();
    const lead = leadData as {
      name: string | null;
      phone: string | null;
      property: { address: string | null } | { address: string | null }[] | null;
    } | null;
    const prop = Array.isArray(lead?.property) ? lead?.property[0] : lead?.property;
    const dashboardUrl = `${APP_URL}/dashboard/leads/${opts.leadId}`;

    await sendOrgNotification({
      client: admin,
      org: {
        id: o.id,
        name: o.name,
        brand_color: o.brand_color,
        logo_url: o.logo_url,
        reply_to_email: o.reply_to_email,
      },
      eventKey: "leasing.renter_text_reply",
      vars: {
        org_name: o.name ?? "",
        property_address: prop?.address?.trim() || "their rental",
        lead_name: lead?.name?.trim() || "A renter",
        lead_phone: lead?.phone?.trim() || "no phone on file",
        reply_text: opts.confirmedViewing
          ? `${opts.replyText}\n\n(Their viewing is now marked confirmed.)`
          : opts.replyText,
        dashboard_url: dashboardUrl,
      },
      operatorFallback,
      audienceEmail: agentEmail,
      action: { label: "Open the renter", url: dashboardUrl },
    });
  } catch {
    // Alerts are best-effort; the reply is already on the renter's record.
  }
}

/**
 * S750: the email of the showing agent assigned to this renter's next viewing
 * (still scheduled, from 2 hours ago on), or null. Archived agents are skipped.
 */
async function nextViewingAgentEmail(
  admin: SupabaseClient,
  orgId: string,
  leadId: string,
): Promise<string | null> {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("showings")
    .select("scheduled_at, assigned_agent:showing_agents(email, archived)")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .eq("outcome", "scheduled")
    .not("assigned_agent_id", "is", null)
    .gte("scheduled_at", since)
    .order("scheduled_at", { ascending: true })
    .limit(1);
  const row = ((data ?? []) as unknown as {
    assigned_agent: { email: string | null; archived: boolean | null } | { email: string | null; archived: boolean | null }[] | null;
  }[])[0];
  const agent = Array.isArray(row?.assigned_agent) ? row?.assigned_agent[0] : row?.assigned_agent;
  if (!agent || agent.archived) return null;
  return agent.email?.trim() || null;
}
