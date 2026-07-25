// Shared server-side "a new lead came in — tell the leasing team" notifier,
// resolved BY LEAD ID so any write path can call it with nothing but the id.
//
// WHY THIS EXISTS (S568). The public /r form has always notified operators of a
// new lead (app/r/[propertyId]/actions.ts::notifyOperatorsOfNewLead). The S567
// portal-lead ingest (app/api/inbound/lead/route.ts) writes the lead the same
// way the /r form does — via submit_public_lead, stamped with the portal source
// — but it never notified anyone, so a rentals.ca renter who inquired on a live
// ad landed a row in the dashboard that nobody was told about. For the one org
// dogfooding the ingest (Agile) that inbox IS the workflow: the worker now puts
// the org's ingest address in the rentals.ca lead-contact slot, so the portal
// email no longer reaches the operator's own inbox at all — the app is the only
// thing that can tell her. This closes that gap.
//
// HOW IT ROUTES. It calls the SAME sendOrgNotification path + the SAME
// leasing.new_lead event as the /r form, so an ingested lead notifies exactly
// the people a walled-garden lead already does. Recipient resolution is
// unchanged and per-org: notification_settings.recipients override (wins) ->
// org_notification_lanes 'showing' lane (S554 middle tier) -> the manage_leads
// capability members, with the org's reply-to / public contact as the last
// resort so an alert is never sent to nobody. An org that wants a different
// destination sets a lane row or a settings override; an org that wants silence
// disables the leasing.new_lead event. No new flag, no migration.
//
// BEST-EFFORT, exactly like the /r notifier: it NEVER throws. The lead is
// already stored; a mail failure (or a missing BREVO key, or the lane table not
// existing on an older deploy) must never turn a captured renter into an error
// for the inbound webhook, which would tell the provider to retry a lead we
// already have.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendOrgNotification } from "./notifications-server";
import {
  resolveLeadNotifyEmailsPreferMemberFallback,
  formatLeadScreeningBlock,
  type LeadScreeningSnapshot,
} from "./leads-notify";
import type { NotifyMember } from "./incident-reports";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

// Same cap the /r notifier uses, so a huge roster can't fan a single lead out to
// an unbounded recipient list.
const MAX_LEAD_NOTIFY_RECIPIENTS = 10;

type NewLeadRow = {
  name: string | null;
  email: string | null;
  phone: string | null;
  move_in: string | null;
  property_id: string | null;
  property: { address: string | null } | null;
} & LeadScreeningSnapshot;

export type NotifyNewLeadOptions = {
  orgId: string;
  leadId: string;
  // A readable stand-in when the lead resolved to no property (the ingest's
  // "filed unattributed" path), e.g. the address the portal put in the subject.
  // The operator still needs a hint about what the renter asked about.
  propertyAddressFallback?: string | null;
};

/**
 * Notify the org's leasing team that lead `leadId` came in. Reads the org,
 * members, and the lead (with its property address) via the admin client, then
 * fans out through sendOrgNotification. Never throws.
 */
export async function notifyOperatorsOfNewLeadById(
  admin: SupabaseClient,
  opts: NotifyNewLeadOptions,
): Promise<void> {
  try {
    const { data: org } = await admin
      .from("organizations")
      .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email")
      .eq("id", opts.orgId)
      .maybeSingle();
    if (!org) return;

    // Org members -> resolve each one's auth email (RLS-hidden from anon; the
    // admin client reads them). Mirrors the /r notifier exactly.
    const { data: memberRows } = await admin
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", opts.orgId);
    const members: NotifyMember[] = [];
    for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      members.push({ role: m.role, email: u?.user?.email ?? null });
    }
    const operatorFallback = resolveLeadNotifyEmailsPreferMemberFallback(members, [
      (org as { reply_to_email: string | null }).reply_to_email,
      (org as { public_contact_email: string | null }).public_contact_email,
    ]).slice(0, MAX_LEAD_NOTIFY_RECIPIENTS);

    // The lead itself + its property address + any screening snapshot (portal
    // leads carry none, so this resolves to "" and the block collapses).
    const { data: leadData } = await admin
      .from("leads")
      .select(
        "name, email, phone, move_in, property_id, screen_income_cents, screen_occupants, screen_has_pets, screen_pets_detail, screen_custom_answers, property:properties(address)",
      )
      .eq("id", opts.leadId)
      .maybeSingle();
    const lead = (leadData as NewLeadRow | null) ?? null;

    const propertyAddress =
      lead?.property?.address?.trim() ||
      opts.propertyAddressFallback?.trim() ||
      "(needs manual assignment)";
    const screening = formatLeadScreeningBlock(lead);
    const dashboardUrl = `${APP_URL}/dashboard/leads/${opts.leadId}`;

    await sendOrgNotification({
      client: admin,
      org: {
        id: (org as { id: string }).id,
        name: (org as { name: string | null }).name,
        brand_color: (org as { brand_color: string | null }).brand_color,
        logo_url: (org as { logo_url: string | null }).logo_url,
        reply_to_email: (org as { reply_to_email: string | null }).reply_to_email,
      },
      eventKey: "leasing.new_lead",
      vars: {
        org_name: (org as { name: string | null }).name ?? "",
        property_address: propertyAddress,
        lead_name: lead?.name?.trim() || "(no name given)",
        lead_email: lead?.email?.trim() || "(no email)",
        lead_phone: lead?.phone?.trim() || "(no phone)",
        move_in: lead?.move_in?.trim() || "(not specified)",
        // The /r booking flow sets this when a renter couldn't find a viewing
        // time; a portal-ingested lead has no booking step, so it is always blank.
        no_suitable_time_note: "",
        screening,
        dashboard_url: dashboardUrl,
      },
      operatorFallback,
      action: { label: "View lead", url: dashboardUrl },
    });
  } catch {
    // Swallow — the lead is saved; the operator alert is best-effort and must
    // never surface as a webhook error.
  }
}
