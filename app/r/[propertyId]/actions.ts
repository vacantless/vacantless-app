"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendAutoReply,
  sendBookingConfirmation,
  type AutoReplyPayload,
} from "@/lib/email";
import { sendSms, bookingConfirmationSms } from "@/lib/sms";
import { isValidSlot, formatSlotLong, type Availability } from "@/lib/booking";
import { parseIncomeToCents, parseCount } from "@/lib/screening";
import { sendOrgNotification } from "@/lib/notifications-server";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_LEAD_NOTIFY_RECIPIENTS = 10;

// Notify the org's leasing team that a new lead came in — the first
// Agile→Vacantless teardown event (replaces Zap 362007976). Runs on the anon
// submit-lead path, so it reads the org + member emails (RLS-hidden from anon)
// via the service-role admin client, exactly like notifyOperatorsOfNewReport
// (Slice 4). Best-effort: it NEVER throws, so a mail failure can't turn a
// captured lead into an error for the renter. The customizable substrate
// (Settings → Notifications) overrides copy/recipients/on-off per org; this only
// supplies the default audience + the {{token}} values.
async function notifyOperatorsOfNewLead(
  payload: AutoReplyPayload,
  extra: { phone: string; moveIn: string },
): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin) return; // no service key -> can't read members; skip quietly

    const { data: org } = await admin
      .from("organizations")
      .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email")
      .eq("id", payload.org_id)
      .maybeSingle();
    if (!org) return;

    // Org members -> resolve each one's auth email, then keep the leasing roles.
    const { data: memberRows } = await admin
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", payload.org_id);
    const members: NotifyMember[] = [];
    for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      members.push({ role: m.role, email: u?.user?.email ?? null });
    }
    const operatorFallback = resolveLeadNotifyEmails(members, [
      org.reply_to_email,
      org.public_contact_email,
    ]).slice(0, MAX_LEAD_NOTIFY_RECIPIENTS);

    await sendOrgNotification({
      client: admin,
      org: {
        id: org.id,
        name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
      },
      eventKey: "leasing.new_lead",
      vars: {
        org_name: org.name ?? "",
        property_address: payload.property_address ?? "(unspecified property)",
        lead_name: payload.renter_name?.trim() || "(no name given)",
        lead_email: payload.renter_email?.trim() || "(no email)",
        lead_phone: extra.phone.trim() || "(no phone)",
        move_in: extra.moveIn.trim() || "(not specified)",
        dashboard_url: `${APP_URL}/dashboard/leads/${payload.lead_id}`,
      },
      operatorFallback,
      action: {
        label: "View lead",
        url: `${APP_URL}/dashboard/leads/${payload.lead_id}`,
      },
    });
  } catch {
    // Swallow — the lead is saved; the operator alert is best-effort.
  }
}

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

  // Candidate pre-screening answers (only present when the org enabled it).
  // Parsed defensively; the RPC computes the authoritative qualify-out snapshot.
  const incomeCents = parseIncomeToCents(
    String(formData.get("screen_income") ?? ""),
  );
  const occupants = parseCount(String(formData.get("screen_occupants") ?? ""));
  const petsDetail = String(formData.get("screen_pets_detail") ?? "").trim();
  // The screening fieldset only renders when the org enabled it; detect that
  // via the always-present income field so non-screening leads keep pets = null
  // (unknown) rather than a misleading "no".
  const screeningShown = formData.has("screen_income");
  // A pet is indicated by the checkbox OR by typing pet details.
  const hasPets = screeningShown
    ? formData.get("screen_has_pets") != null || petsDetail.length > 0
    : null;

  // Custom pre-screening answers (S291). The form names each field cq_<questionId>.
  // We pass the raw {question_id, answer} pairs; the RPC re-fetches the org's
  // active questions and authoritatively normalizes + snapshots them (it ignores
  // any id that is not a real active question for this org).
  const customAnswers: { question_id: string; answer: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("cq_")) continue;
    const answer = String(value ?? "").trim();
    if (answer.length === 0) continue;
    customAnswers.push({ question_id: key.slice(3), answer });
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("submit_public_lead", {
    p_property_id: propertyId,
    p_name: name || null,
    p_email: email || null,
    p_phone: phone || null,
    p_move_in: moveInRaw || null,
    p_notes: notes || null,
    p_listing_post_id: listingPostId || null,
    p_income_cents: incomeCents,
    p_occupants: occupants,
    p_has_pets: hasPets,
    p_pets_detail: petsDetail || null,
    p_custom_answers: customAnswers,
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

  // Tell the leasing team a new lead landed (best-effort; never blocks the
  // renter). Fires regardless of whether they also booked a showing below.
  await notifyOperatorsOfNewLead(payload, { phone, moveIn: moveInRaw });

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
