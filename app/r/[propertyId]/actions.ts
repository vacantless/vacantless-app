"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  sendAutoReply,
  sendBookingConfirmation,
  type AutoReplyPayload,
} from "@/lib/email";
import { sendSms, bookingConfirmationSms } from "@/lib/sms";
import { isValidSlot, formatSlotLong, type Availability } from "@/lib/booking";

// Public, unauthenticated lead submission. Calls a SECURITY DEFINER RPC that
// resolves the org from the property and inserts the lead — the renter can
// create a lead but can never read or target another tenant's data. If the
// renter also picked a showing slot, we book it (M3) and send a booking
// confirmation; otherwise we fall back to the M2 instant auto-reply. Every
// email path is best-effort: nothing here can turn a captured lead into an
// error for the renter.
export async function submitLead(formData: FormData) {
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const moveInRaw = String(formData.get("move_in") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const slot = String(formData.get("slot") ?? "").trim();
  // Source-tracking: a per-post tracked link carries ?p=<listing_post_id>. The
  // RPC validates it belongs to this property before stamping the lead's
  // source; an absent/foreign value safely falls back to 'website'.
  const listingPostId = String(formData.get("listing_post_id") ?? "").trim();

  const supabase = createClient();
  const { data, error } = await supabase.rpc("submit_public_lead", {
    p_property_id: propertyId,
    p_name: name || null,
    p_email: email || null,
    p_phone: phone || null,
    p_move_in: moveInRaw || null,
    p_notes: notes || null,
    p_listing_post_id: listingPostId || null,
  });

  if (error) {
    const keep = listingPostId
      ? `&p=${encodeURIComponent(listingPostId)}`
      : "";
    redirect(`/r/${propertyId}?error=1${keep}`);
  }

  const payload = data as AutoReplyPayload | null;
  if (!payload?.lead_id) {
    redirect(`/r/${propertyId}?submitted=1`);
  }

  let outcome: "submitted" | "booked" | "booking_failed" = "submitted";
  // The renter picked a time but it was no longer bookable (already taken
  // between page load and submit, or won a same-instant race). Drives a distinct
  // "that time was just taken" state on the page instead of the generic
  // inquiry-received message (audit B1). The lead is still saved either way.
  let slotTaken = false;

  // --- Booking path -------------------------------------------------------
  if (slot) {
    let booked = false;
    try {
      // Re-validate the chosen slot server-side against live availability
      // before booking (the RPC additionally guards recency + double-booking).
      const { data: avData } = await supabase.rpc("get_public_availability", {
        p_property_id: propertyId,
      });
      const av = avData as Availability | null;

      if (av && !isValidSlot(av, slot)) {
        // The slot is no longer offered (taken / fell outside the window since
        // the page loaded). Tell the renter rather than silently dropping it.
        slotTaken = true;
      } else if (av && isValidSlot(av, slot)) {
        const { data: bookData, error: bookErr } = await supabase.rpc(
          "book_public_showing",
          {
            p_lead_id: payload.lead_id,
            p_property_id: propertyId,
            p_slot: slot,
          },
        );
        // The RPC raises 'That time was just taken' on the unique-violation race
        // (two renters, same instant). Any booking error after the slot passed
        // re-validation means the time is gone, so surface the pick-another state.
        if (bookErr) {
          slotTaken = true;
        }
        if (!bookErr && bookData) {
          booked = true;
          const b = bookData as {
            scheduled_at: string;
            timezone: string | null;
            org_name: string | null;
            brand_color: string | null;
            logo_url: string | null;
            reply_to_email: string | null;
            property_address: string | null;
            renter_name: string | null;
            renter_email: string | null;
            sms_enabled?: boolean | null;
            renter_phone?: string | null;
            sms_opt_out?: boolean | null;
          };
          const whenLabel = formatSlotLong(
            b.scheduled_at,
            b.timezone || "America/Toronto",
          );
          const result = await sendBookingConfirmation({
            lead_id: payload.lead_id,
            renter_name: b.renter_name,
            renter_email: b.renter_email,
            org_name: b.org_name,
            brand_color: b.brand_color,
            logo_url: b.logo_url,
            reply_to_email: b.reply_to_email,
            property_address: b.property_address,
            when_label: whenLabel,
          });
          if (result.sent) {
            await supabase.rpc("record_booking_email", {
              p_lead_id: payload.lead_id,
              p_to: b.renter_email,
              p_subject: result.subject ?? null,
            });
          }

          // Parallel booking-confirmation SMS, when the org has SMS on and the
          // renter left a usable number AND has not opted out (a prior STOP for
          // this number is inherited onto the new lead at creation). Best-effort
          // (no_credentials until Twilio is configured); the renter just
          // consented by booking.
          if (b.sms_enabled && b.renter_phone && !b.sms_opt_out) {
            const sms = await sendSms({
              to: b.renter_phone,
              body: bookingConfirmationSms({
                org_name: b.org_name,
                property_address: b.property_address,
                when_label: whenLabel,
              }),
            });
            if (sms.sent) {
              await supabase.rpc("record_booking_sms", {
                p_lead_id: payload.lead_id,
                p_to: b.renter_phone,
              });
            }
          }
        }
      }
    } catch {
      // swallow — the lead is saved; fall through to the auto-reply below.
    }
    outcome = booked ? "booked" : "booking_failed";
  }

  // --- Auto-reply path (no slot, or booking failed) -----------------------
  if (outcome !== "booked") {
    try {
      const result = await sendAutoReply(payload);
      if (result.sent) {
        await supabase.rpc("record_auto_reply", {
          p_lead_id: payload.lead_id,
          p_subject: result.subject ?? null,
          p_to: payload.renter_email,
        });
      }
    } catch {
      // swallow — the lead is already saved; auto-reply is non-critical.
    }
  }

  const submittedState =
    outcome === "booked" ? "booked" : slotTaken ? "slottaken" : "1";
  redirect(`/r/${propertyId}?submitted=${submittedState}`);
}
