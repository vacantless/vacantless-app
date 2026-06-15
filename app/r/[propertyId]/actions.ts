"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendAutoReply, type AutoReplyPayload } from "@/lib/email";

// Public, unauthenticated lead submission. Calls a SECURITY DEFINER RPC that
// resolves the org from the property and inserts the lead — the renter can
// create a lead but can never read or target another tenant's data. The RPC
// returns the payload needed to fire an instant branded auto-reply (best-effort:
// a failed/dormant email never blocks the lead from being captured).
export async function submitLead(formData: FormData) {
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const moveInRaw = String(formData.get("move_in") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  const supabase = createClient();
  const { data, error } = await supabase.rpc("submit_public_lead", {
    p_property_id: propertyId,
    p_name: name || null,
    p_email: email || null,
    p_phone: phone || null,
    p_move_in: moveInRaw || null,
    p_notes: notes || null,
  });

  if (error) {
    redirect(`/r/${propertyId}?error=1`);
  }

  // Instant auto-reply — entirely best-effort. Wrapped so nothing here can throw
  // and turn a captured lead into an error for the renter. Stays dormant until
  // BREVO_API_KEY is set in the environment.
  const payload = data as AutoReplyPayload | null;
  if (payload?.lead_id) {
    try {
      const result = await sendAutoReply(payload);
      if (result.sent) {
        // Log the sent email to the lead's activity timeline (anon-safe RPC,
        // scoped to this just-created lead).
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

  redirect(`/r/${propertyId}?submitted=1`);
}
