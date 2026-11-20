"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendBookingConfirmation } from "@/lib/email";
import { formatSlotLong } from "@/lib/booking";
import { viewingCalendarUrl } from "@/lib/viewing-calendar-server";
import { autoAssignBookedShowing, notifyOperatorsOfViewingBooked } from "@/lib/showing-booked-server";
import { offerStatusForReason } from "@/lib/viewing-offers";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

type AcceptResult = {
  ok?: boolean;
  reason?: string;
  lead_id?: string | null;
  property_id?: string | null;
  showing_id?: string | null;
  cancel_token?: string | null;
  scheduled_at?: string | null;
  timezone?: string | null;
  org_name?: string | null;
  brand_color?: string | null;
  logo_url?: string | null;
  mail_alias?: string | null;
  reply_to_email?: string | null;
  property_address?: string | null;
  renter_name?: string | null;
  renter_email?: string | null;
};

function path(token: string, status: string): string {
  return `/showing/offer/${encodeURIComponent(token)}?status=${status}`;
}

async function confirmToRenter(
  supabase: ReturnType<typeof createClient>,
  r: AcceptResult,
): Promise<void> {
  try {
    if (!r.lead_id || !r.scheduled_at || !r.renter_email) return;
    const timeZone = r.timezone || "America/Toronto";
    let leasingPhone: string | null = null;
    let mailAlias: string | null = r.mail_alias ?? null;
    if (r.property_id) {
      const { data: extras } = await supabase.rpc("get_booking_confirmation_extras", {
        p_property_id: r.property_id,
      });
      const e = extras as { leasing_phone?: string | null; mail_alias?: string | null } | null;
      leasingPhone = e?.leasing_phone ?? null;
      mailAlias = e?.mail_alias ?? mailAlias;
    }
    const result = await sendBookingConfirmation({
      lead_id: r.lead_id,
      showing_id: r.showing_id ?? null,
      renter_name: r.renter_name ?? null,
      renter_email: r.renter_email,
      org_name: r.org_name ?? null,
      brand_color: r.brand_color ?? null,
      logo_url: r.logo_url ?? null,
      mail_alias: mailAlias,
      reply_to_email: r.reply_to_email ?? null,
      property_address: r.property_address ?? null,
      when_label: formatSlotLong(r.scheduled_at, timeZone),
      cancel_url: r.cancel_token ? `${APP_URL}/showing/cancel/${r.cancel_token}` : null,
      leasing_phone: leasingPhone,
      // The landlord offered this time, so it is confirmed the moment it is picked.
      booking_requires_confirmation: false,
      calendar_url: viewingCalendarUrl(r.showing_id ?? null),
    });
    if (result.sent) {
      await supabase.rpc("record_booking_email", {
        p_lead_id: r.lead_id,
        p_to: r.renter_email,
        p_subject: result.subject ?? null,
      });
    }
  } catch {
    // Best-effort: the viewing is booked either way.
  }
}

// S823c: the renter taps one of the times the landlord offered.
export async function acceptOfferedTime(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const slot = String(formData.get("slot") ?? "").trim();
  if (!token) redirect("/showing/offer/invalid?status=invalid");
  if (!slot) redirect(path(token, "invalid"));

  const supabase = createClient();
  const { data, error } = await supabase.rpc("accept_viewing_offer", {
    p_token: token,
    p_slot: slot,
  });
  const result = (data as AcceptResult | null) ?? null;
  if (error || !result?.ok) {
    redirect(path(token, offerStatusForReason(result?.reason)));
  }

  await confirmToRenter(supabase, result);
  if (result.showing_id) {
    await autoAssignBookedShowing(result.showing_id);
    await notifyOperatorsOfViewingBooked(result.showing_id);
  }
  redirect(path(token, "accepted"));
}
