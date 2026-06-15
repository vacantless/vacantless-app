"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Public, unauthenticated lead submission. Calls a SECURITY DEFINER RPC that
// resolves the org from the property and inserts the lead — the renter can
// create a lead but can never read or target another tenant's data.
export async function submitLead(formData: FormData) {
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const moveInRaw = String(formData.get("move_in") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  const supabase = createClient();
  const { error } = await supabase.rpc("submit_public_lead", {
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
  redirect(`/r/${propertyId}?submitted=1`);
}
