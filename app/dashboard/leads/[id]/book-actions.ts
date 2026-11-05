"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { formatSlotLong, parseLocalInputToUtc } from "@/lib/booking";
import { sendBookingConfirmation } from "@/lib/email";
import { sendSms, bookingConfirmationSms, smsLive } from "@/lib/sms";
import { canUseRenterSms } from "@/lib/billing";
import { viewingCalendarUrl } from "@/lib/viewing-calendar-server";
import { autoAssignBookedShowing, notifyOperatorsOfViewingBooked } from "@/lib/showing-booked-server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

// S750: staff book a viewing for a renter from the renter's page. The renter
// page enforces the account's notice (Agile: 12 hours), so a renter who calls
// or writes for "tonight" had no bookable time (Axu, 11-04). Staff can pick
// any future time here; the notice and viewing hours are the renter's rules,
// not the team's. The viewing counts as confirmed (staff set it with the
// renter), the renter gets the usual confirmation email and text, and it goes
// to an agent the same way a renter booking does.
export async function bookViewingForRenter(formData: FormData) {
  const leadId = String(formData.get("lead_id") ?? "");
  const back = (code: string) => redirect(`/dashboard/leads/${leadId}?book=${code}#viewings`);
  await requireCapability("manage_leads", `/dashboard/leads/${leadId}?book=forbidden#viewings`);
  const rawWhen = String(formData.get("scheduled_at") ?? "").trim();
  const tell = String(formData.get("tell_renter") ?? "") === "yes";
  if (!leadId) redirect("/dashboard/leads");
  if (!rawWhen) back("no_time");

  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  const timeZone = org.booking_timezone ?? "America/Toronto";
  const when = parseLocalInputToUtc(rawWhen, timeZone);
  if (!when) back("no_time");
  if ((when as Date).getTime() <= Date.now()) back("past");
  const iso = (when as Date).toISOString();

  const supabase = createClient();
  const { data: leadRow } = await supabase
    .from("leads")
    .select("id, organization_id, name, email, phone, sms_opt_out, property_id, property:properties(id, address, status)")
    .eq("id", leadId)
    .eq("organization_id", org.id)
    .maybeSingle();
  const lead = leadRow as {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    sms_opt_out: boolean | null;
    property_id: string | null;
    property: { id: string; address: string | null; status: string | null } | null;
  } | null;
  if (!lead) back("error");
  if (!lead!.property_id) back("no_rental");

  const { data: inserted, error } = await supabase
    .from("showings")
    .insert({
      organization_id: org.id,
      lead_id: lead!.id,
      property_id: lead!.property_id,
      scheduled_at: iso,
      outcome: "scheduled",
      confirmed_at: new Date().toISOString(),
      confirmed_by: "agent",
    })
    .select("id, cancel_token")
    .maybeSingle();
  if (error || !inserted) back(error?.code === "23505" ? "taken" : "error");
  const showing = inserted as { id: string; cancel_token: string | null };

  await supabase
    .from("leads")
    .update({ status: "booked" })
    .eq("id", lead!.id)
    .in("status", ["new", "replied", "contacted", "booked", "lost"]);

  const label = formatSlotLong(iso, timeZone);
  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: lead!.id,
    channel: "note",
    direction: "outbound",
    body: `Viewing booked by the team for ${label}.${tell ? "" : " The renter was not sent a confirmation."}`,
  });

  if (tell) {
    if (lead!.email) {
      try {
        await sendBookingConfirmation({
          lead_id: lead!.id,
          showing_id: showing.id,
          renter_name: lead!.name,
          renter_email: lead!.email,
          org_name: org.name,
          brand_color: org.brand_color,
          logo_url: org.logo_url,
          mail_alias: org.mail_alias,
          reply_to_email: org.reply_to_email,
          property_address: lead!.property?.address ?? null,
          when_label: label,
          cancel_url: showing.cancel_token ? `${APP_URL}/showing/cancel/${showing.cancel_token}` : null,
          leasing_phone: org.showing_arrival_phone ?? org.public_contact_phone ?? null,
          booking_requires_confirmation: false,
          calendar_url: viewingCalendarUrl(showing.id),
        });
      } catch {
        // Best-effort: the viewing is booked either way.
      }
    }
    if (org.sms_enabled && canUseRenterSms(org.plan) && smsLive() && lead!.phone && !lead!.sms_opt_out) {
      try {
        await sendSms({
          organizationId: org.id,
          to: lead!.phone,
          body: bookingConfirmationSms({
            org_name: org.name,
            property_address: lead!.property?.address ?? null,
            when_label: label,
            booking_requires_confirmation: false,
            arrival_phone: org.showing_arrival_phone ?? org.public_contact_phone ?? null,
          }),
        });
      } catch {
        // Best-effort.
      }
    }
  }

  await autoAssignBookedShowing(showing.id);
  await notifyOperatorsOfViewingBooked(showing.id);

  revalidatePath(`/dashboard/leads/${lead!.id}`);
  revalidatePath("/dashboard/showings");
  back("booked");
}
