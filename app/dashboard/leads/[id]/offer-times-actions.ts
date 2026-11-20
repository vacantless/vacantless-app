"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { formatSlotLong, parseLocalInputToUtc } from "@/lib/booking";
import { sendViewingOffer } from "@/lib/email";
import { normalizeOfferSlots } from "@/lib/viewing-offers";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

// S823c: the landlord offers one renter up to three viewing times. Nothing is
// booked and no time is held until the renter taps one (accept_viewing_offer,
// migration 0312). The times are the landlord's own choice, so the account's
// viewing windows and notice do not apply, the same as "Book a viewing for
// this renter". A new offer replaces the renter's earlier one.
export async function offerTimesToRenter(formData: FormData) {
  const leadId = String(formData.get("lead_id") ?? "");
  const back = (code: string) => redirect(`/dashboard/leads/${leadId}?times=${code}#viewings`);
  await requireCapability("manage_leads", `/dashboard/leads/${leadId}?times=forbidden#viewings`);
  if (!leadId) redirect("/dashboard/leads");

  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  const timeZone = org.booking_timezone ?? "America/Toronto";

  const raw = formData.getAll("slot").map((v) => String(v ?? "").trim()).filter(Boolean);
  if (raw.length === 0) back("no_time");
  const parsed = raw.map((v) => parseLocalInputToUtc(v, timeZone));
  if (parsed.every((d) => !d)) back("no_time");
  const slots = normalizeOfferSlots(parsed);
  if (slots.length === 0) back("past");
  const emailIt = String(formData.get("email_renter") ?? "") === "yes";

  const supabase = createClient();
  const { data: leadRow } = await supabase
    .from("leads")
    .select("id, name, email, property_id, property:properties(id, address)")
    .eq("id", leadId)
    .eq("organization_id", org.id)
    .maybeSingle();
  const lead = leadRow as {
    id: string;
    name: string | null;
    email: string | null;
    property_id: string | null;
    property: { id: string; address: string | null } | null;
  } | null;
  if (!lead) back("error");
  if (!lead!.property_id) back("no_rental");

  await supabase
    .from("viewing_offers")
    .update({ status: "expired", responded_at: new Date().toISOString() })
    .eq("organization_id", org.id)
    .eq("lead_id", lead!.id)
    .eq("status", "pending");

  const { data: inserted, error } = await supabase
    .from("viewing_offers")
    .insert({
      organization_id: org.id,
      lead_id: lead!.id,
      property_id: lead!.property_id,
      proposed_slots: slots,
    })
    .select("id, token")
    .maybeSingle();
  if (error || !inserted) back("error");
  const offer = inserted as { id: string; token: string };

  const labels = slots.map((s) => formatSlotLong(s, timeZone));
  let code = "saved";
  if (emailIt && lead!.email) {
    let sent = false;
    try {
      const result = await sendViewingOffer({
        lead_id: lead!.id,
        renter_name: lead!.name,
        renter_email: lead!.email,
        org_name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        mail_alias: org.mail_alias,
        reply_to_email: org.reply_to_email,
        property_address: lead!.property?.address ?? null,
        offered_when_labels: labels,
        offer_url: `${APP_URL}/showing/offer/${offer.token}`,
      });
      sent = result.sent;
    } catch {
      sent = false;
    }
    code = sent ? "sent" : "send_failed";
  }

  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: lead!.id,
    channel: "note",
    direction: "outbound",
    body: `Viewing times offered: ${labels.join("; ")}.${code === "sent" ? " Emailed to the renter." : " Not emailed; send the link yourself."}`,
  });

  revalidatePath(`/dashboard/leads/${lead!.id}`);
  back(code);
}

export async function withdrawOfferedTimes(formData: FormData) {
  const leadId = String(formData.get("lead_id") ?? "");
  await requireCapability("manage_leads", `/dashboard/leads/${leadId}?times=forbidden#viewings`);
  if (!leadId) redirect("/dashboard/leads");
  const org = await getCurrentOrg();
  if (!org) redirect("/login");

  const supabase = createClient();
  const { error } = await supabase
    .from("viewing_offers")
    .update({ status: "withdrawn", responded_at: new Date().toISOString() })
    .eq("organization_id", org.id)
    .eq("lead_id", leadId)
    .eq("status", "pending");

  revalidatePath(`/dashboard/leads/${leadId}`);
  redirect(`/dashboard/leads/${leadId}?times=${error ? "error" : "withdrawn"}#viewings`);
}
