import type { SupabaseClient } from "@supabase/supabase-js";
import { canUseRenterSms } from "@/lib/billing";
import { listingUrl } from "@/lib/email";
import {
  isWithinQuietHours,
  normalizePhoneE164,
  sendSms,
  smsLive,
  viewingTimesOpenedSms,
} from "@/lib/sms";

// S709: the text that goes with the "new viewing times opened" email. Same
// gates as every renter text (SMS live, org texting on, plan allows it, not
// opted out) plus quiet hours, because this one is a nudge, not a reply to
// something the renter just did. Never throws; false = not texted.

export type ReopenSmsOrg = {
  id: string;
  name: string | null;
  sms_enabled: boolean | null;
  plan: string | null;
  booking_timezone: string | null;
};

export function reopenSmsAllowed(org: ReopenSmsOrg, now: Date, live: boolean): boolean {
  if (!live) return false;
  if (org.sms_enabled !== true || !canUseRenterSms(org.plan)) return false;
  return !isWithinQuietHours(now, org.booking_timezone || "America/Toronto");
}

export async function textViewingTimesOpened(
  admin: SupabaseClient,
  args: {
    org: ReopenSmsOrg;
    leadId: string;
    propertyId: string;
    phone: string | null;
    address: string | null;
  },
  now: Date = new Date(),
  send: typeof sendSms = sendSms,
): Promise<boolean> {
  try {
    const to = normalizePhoneE164(args.phone);
    if (!to || !reopenSmsAllowed(args.org, now, smsLive())) return false;
    const { data: optedOut } = await admin
      .from("leads")
      .select("id")
      .eq("phone_e164", to)
      .eq("sms_opt_out", true)
      .limit(1);
    if ((optedOut ?? []).length > 0) return false;
    const body = viewingTimesOpenedSms({
      org_name: args.org.name,
      property_address: args.address,
      booking_url: listingUrl(args.propertyId),
    });
    const result = await send({ to, body });
    if (result.sent) {
      await admin.from("messages").insert({
        organization_id: args.org.id,
        lead_id: args.leadId,
        channel: "sms",
        direction: "outbound",
        body,
      });
    }
    return result.sent;
  } catch (err) {
    console.error("textViewingTimesOpened failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
