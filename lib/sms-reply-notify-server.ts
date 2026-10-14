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
  opts: { orgId: string; leadId: string; replyText: string },
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
    const operatorFallback = resolveLeadNotifyEmailsPreferMemberFallback(members, [
      o.reply_to_email,
      o.public_contact_email,
    ]).slice(0, MAX_RECIPIENTS);

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
        reply_text: opts.replyText,
        dashboard_url: dashboardUrl,
      },
      operatorFallback,
      action: { label: "Open the renter", url: dashboardUrl },
    });
  } catch {
    // Alerts are best-effort; the reply is already on the renter's record.
  }
}
