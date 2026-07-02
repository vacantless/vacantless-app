"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
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
import { resolveLeadNotifyEmails, formatLeadScreeningBlock } from "@/lib/leads-notify";
import { buildTrackedLink } from "@/lib/listing-distribution";
import type { NotifyMember } from "@/lib/incident-reports";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_LEAD_NOTIFY_RECIPIENTS = 10;

// A slot-taken retry (P2c, Best-In-Class QA 2026-07-01) must let the renter pick
// another time WITHOUT re-submitting personal details (which would create a
// duplicate lead). We remember the just-saved lead id server-side in a
// short-lived, httpOnly, per-property cookie — never in the URL — so the retry
// books against the SAME lead with no IDOR surface (the renter can only rebook
// the lead we saved for their own session). Cleared once a viewing is booked.
const SAVED_LEAD_COOKIE_TTL_S = 30 * 60; // 30 minutes
function savedLeadCookieName(propertyId: string): string {
  return `vl_lead_${propertyId}`;
}

// Preserve the tracked-post attribution (?p=) across every redirect so a
// slot-taken retry (or a refresh of the confirmation) never loses the source.
// Reuses the canonical tracked-link builder (lib/listing-distribution) rather
// than re-deriving the append rule.
function withTracking(path: string, listingPostId: string): string {
  return buildTrackedLink(path, listingPostId);
}

// The booking side effect shared by the first submit and the slot-taken retry:
// re-validate the chosen slot against LIVE availability, book it, and fire the
// confirmation email (+ SMS when enabled). Pure of the lead-capture concern, so
// the retry path can reuse it without re-inserting a lead. Returns which of the
// two terminal states happened; a non-slot booking error surfaces as slotTaken
// ("pick another time"), matching the original inline behaviour.
async function attemptBooking(
  supabase: ReturnType<typeof createClient>,
  leadId: string,
  propertyId: string,
  slot: string,
): Promise<{ booked: boolean; slotTaken: boolean }> {
  let booked = false;
  let slotTaken = false;
  try {
    const { data: avData } = await supabase.rpc("get_public_availability", {
      p_property_id: propertyId,
    });
    const av = avData as Availability | null;

    if (av && !isValidSlot(av, slot)) {
      slotTaken = true;
    } else if (av && isValidSlot(av, slot)) {
      const { data: bookData, error: bookErr } = await supabase.rpc(
        "book_public_showing",
        { p_lead_id: leadId, p_property_id: propertyId, p_slot: slot },
      );
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
          lead_id: leadId,
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
            p_lead_id: leadId,
            p_to: b.renter_email,
            p_subject: result.subject ?? null,
          });
        }
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
              p_lead_id: leadId,
              p_to: b.renter_phone,
            });
          }
        }
      }
    }
  } catch {
    // swallow — the lead is saved; the caller falls back appropriately.
  }
  return { booked, slotTaken };
}

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
    // B4 (first-pilot friction pass): a captured lead must never notify nobody.
    // The resolver already routes to leasing-role members (every org's creator is
    // owner_admin, so the happy path reaches the landlord's own email) and then
    // to the org reply-to / public contact. As an ABSOLUTE last resort, add any
    // resolvable member email, so an org that has a member but no leasing-role
    // member and no contact address still gets alerted rather than silently
    // dropping the lead. Only consulted when nothing above resolved.
    const anyMemberEmail =
      members.map((m) => m.email).find((e) => e && e.includes("@")) ?? null;
    const operatorFallback = resolveLeadNotifyEmails(members, [
      org.reply_to_email,
      org.public_contact_email,
      anyMemberEmail,
    ]).slice(0, MAX_LEAD_NOTIFY_RECIPIENTS);

    // Pull the lead's screening snapshot (the RPC already wrote the authoritative
    // values + custom-answer prompts) so the email can inline it — notification
    // parity (S332). Best-effort: a read miss just yields an empty block.
    const { data: lead } = await admin
      .from("leads")
      .select(
        "screen_income_cents, screen_occupants, screen_has_pets, screen_pets_detail, screen_custom_answers",
      )
      .eq("id", payload.lead_id)
      .maybeSingle();
    const screening = formatLeadScreeningBlock(lead);

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
        screening,
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
    redirect(withTracking(`/r/${propertyId}?error=1`, listingPostId));
  }

  const payload = data as AutoReplyPayload | null;
  if (!payload?.lead_id) {
    redirect(withTracking(`/r/${propertyId}?submitted=1`, listingPostId));
  }

  // Remember this lead server-side (httpOnly, per-property, short-lived) so a
  // slot-taken retry can rebook WITHOUT re-collecting details or duplicating the
  // lead (P2c). Set before any redirect (redirect() throws).
  cookies().set(savedLeadCookieName(propertyId), payload.lead_id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/r/${propertyId}`,
    maxAge: SAVED_LEAD_COOKIE_TTL_S,
  });

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
    const r = await attemptBooking(supabase, payload.lead_id, propertyId, slot);
    slotTaken = r.slotTaken;
    outcome = r.booked ? "booked" : "booking_failed";
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

  // A booked viewing closes the retry loop — drop the saved-lead cookie.
  if (outcome === "booked") {
    cookies().delete(savedLeadCookieName(propertyId));
  }

  const submittedState =
    outcome === "booked" ? "booked" : slotTaken ? "slottaken" : "1";
  redirect(
    withTracking(`/r/${propertyId}?submitted=${submittedState}`, listingPostId),
  );
}

// Slot-taken retry (P2c): book another time against the lead we already saved,
// WITHOUT re-collecting personal details or creating a duplicate lead. The lead
// id comes from the httpOnly per-property cookie set on the first submit — never
// from the client — so a renter can only rebook their own saved inquiry. Falls
// back to the full inquiry form if the cookie is gone (expired / cleared).
export async function rebookSavedLead(formData: FormData) {
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;
  const slot = String(formData.get("slot") ?? "").trim();
  const listingPostId = String(formData.get("listing_post_id") ?? "").trim();

  const cookieName = savedLeadCookieName(propertyId);
  const leadId = cookies().get(cookieName)?.value ?? "";
  if (!leadId) {
    // No saved lead (cookie expired/cleared) — send them to the full form.
    redirect(withTracking(`/r/${propertyId}`, listingPostId));
  }
  if (!slot) {
    redirect(
      withTracking(`/r/${propertyId}?submitted=slottaken`, listingPostId),
    );
  }

  const supabase = createClient();
  const { booked } = await attemptBooking(supabase, leadId, propertyId, slot);

  if (booked) {
    cookies().delete(cookieName);
    redirect(withTracking(`/r/${propertyId}?submitted=booked`, listingPostId));
  }
  // Still taken (or a race) — keep the cookie so they can try yet another time.
  redirect(withTracking(`/r/${propertyId}?submitted=slottaken`, listingPostId));
}
