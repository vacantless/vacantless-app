"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { canUseWaitlist } from "@/lib/billing";
import { sendWaitlistVacancyAlert } from "@/lib/email";
import {
  parseBeds,
  parseRentToCents,
  parseDateOrNull,
  normalizeEmail,
  normalizePhone,
  normalizePhoneE164,
  matchesVacancy,
  type WaitlistMatchEntry,
} from "@/lib/waitlist";

// Waiting-list operator server actions (S457). Add / remove / convert an entry
// on a property, and the one-tap "Notify waitlist" that emails everyone matching
// a now-available unit. All gated on manage_leads (a waitlist entry is renter
// capture) AND the `waitlist` entitlement (Growth+); redirect-based, surfacing
// the outcome via ?waitlist=… on the property page (#waitlist anchor). The
// waitlist_entries table (0128) is org-scoped by RLS; we additionally confirm
// the property belongs to this org before writing.

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function propPath(id: string): string {
  return `/dashboard/properties/${id}`;
}

const wlAnchor = (id: string, q: string) =>
  `${propPath(id)}?waitlist=${q}#waitlist`;

/** Confirm the property is in the caller's org (RLS scopes the read). */
async function propertyInOrg(
  supabase: ReturnType<typeof createClient>,
  propertyId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .maybeSingle();
  return !!data;
}

/** Shared gate: manage_leads + the waitlist entitlement + property-in-org. */
async function guard(
  propertyId: string,
): Promise<{ org: { id: string; plan: string | null }; supabase: ReturnType<typeof createClient> }> {
  await requireCapability("manage_leads", wlAnchor(propertyId, "forbidden"));
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!canUseWaitlist(org.plan)) redirect(wlAnchor(propertyId, "locked"));
  const supabase = createClient();
  if (!(await propertyInOrg(supabase, propertyId))) redirect("/dashboard/properties");
  return { org, supabase };
}

// ---------------------------------------------------------------------------
// Add someone to a property's waiting list (operator manual entry).
// ---------------------------------------------------------------------------
export async function addWaitlistEntry(formData: FormData) {
  const propertyId = s(formData, "property_id");
  if (!propertyId) redirect("/dashboard/properties");
  const { org, supabase } = await guard(propertyId);

  const email = normalizeEmail(s(formData, "email"));
  const phone = normalizePhone(s(formData, "phone"));
  // A reachable contact is required.
  if (!email && !phone) redirect(wlAnchor(propertyId, "needcontact"));

  await supabase.from("waitlist_entries").insert({
    organization_id: org.id,
    property_id: propertyId,
    name: s(formData, "name") || null,
    email,
    phone,
    phone_e164: normalizePhoneE164(phone),
    beds_min: parseBeds(s(formData, "beds_min")),
    max_rent_cents: parseRentToCents(s(formData, "max_rent")),
    move_in_by: parseDateOrNull(s(formData, "move_in_by")),
    notes: s(formData, "notes") || null,
    source: "operator",
    status: "active",
  });

  revalidatePath(propPath(propertyId));
  redirect(wlAnchor(propertyId, "added"));
}

// ---------------------------------------------------------------------------
// Remove an entry (operator dismissed it). Hard delete — the waiting list is a
// live queue, not a historical record.
// ---------------------------------------------------------------------------
export async function removeWaitlistEntry(formData: FormData) {
  const propertyId = s(formData, "property_id");
  const id = s(formData, "id");
  if (!propertyId) redirect("/dashboard/properties");
  if (!id) redirect(wlAnchor(propertyId, "notfound"));
  const { supabase } = await guard(propertyId);

  await supabase
    .from("waitlist_entries")
    .delete()
    .eq("id", id)
    .eq("property_id", propertyId);

  revalidatePath(propPath(propertyId));
  redirect(wlAnchor(propertyId, "removed"));
}

// ---------------------------------------------------------------------------
// Mark an entry converted (they became a lead/tenant) — keeps it in the list,
// flagged, and excluded from future notifies.
// ---------------------------------------------------------------------------
export async function convertWaitlistEntry(formData: FormData) {
  const propertyId = s(formData, "property_id");
  const id = s(formData, "id");
  if (!propertyId) redirect("/dashboard/properties");
  if (!id) redirect(wlAnchor(propertyId, "notfound"));
  const { supabase } = await guard(propertyId);

  await supabase
    .from("waitlist_entries")
    .update({ status: "converted", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("property_id", propertyId);

  revalidatePath(propPath(propertyId));
  redirect(wlAnchor(propertyId, "converted"));
}

// ---------------------------------------------------------------------------
// Notify the waiting list that this unit is now available. Matches active
// entries (this property or org-wide) not already notified about it, emails each
// (best-effort), and stamps last_notified_* so re-running never double-sends.
// The property must be 'available'.
// ---------------------------------------------------------------------------
export async function notifyWaitlist(formData: FormData) {
  const propertyId = s(formData, "property_id");
  if (!propertyId) redirect("/dashboard/properties");
  const { org, supabase } = await guard(propertyId);

  // Load the vacancy + its org branding for the alert.
  const { data: prop } = await supabase
    .from("properties")
    .select("id, status, beds, rent_cents, address")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) redirect("/dashboard/properties");
  if (prop.status !== "available") redirect(wlAnchor(propertyId, "notavailable"));

  const { data: orgRow } = await supabase
    .from("organizations")
    .select("name, brand_color, logo_url, reply_to_email")
    .eq("id", org.id)
    .maybeSingle();

  // Candidate entries: active, this property or org-wide, not already notified
  // about THIS property. The final decision uses the pure matcher (belt).
  const { data: rows } = await supabase
    .from("waitlist_entries")
    .select(
      "id, property_id, status, beds_min, max_rent_cents, last_notified_property_id, name, email",
    )
    .eq("organization_id", org.id)
    .eq("status", "active")
    .or(`property_id.eq.${propertyId},property_id.is.null`);

  const candidates = (rows ?? []) as (WaitlistMatchEntry & {
    id: string;
    name: string | null;
    email: string | null;
  })[];

  const vacancy = {
    id: prop.id as string,
    status: prop.status as string,
    beds: (prop.beds as number | null) ?? null,
    rent_cents: (prop.rent_cents as number | null) ?? null,
  };

  let notified = 0;
  for (const entry of candidates) {
    if (!matchesVacancy(entry, vacancy)) continue;
    if (entry.email) {
      await sendWaitlistVacancyAlert({
        entry_id: entry.id,
        property_id: propertyId,
        renter_name: entry.name,
        renter_email: entry.email,
        org_name: orgRow?.name ?? null,
        brand_color: orgRow?.brand_color ?? null,
        logo_url: orgRow?.logo_url ?? null,
        reply_to_email: orgRow?.reply_to_email ?? null,
        property_address: (prop.address as string | null) ?? null,
        rent_cents: vacancy.rent_cents,
      });
    }
    // Stamp regardless of email success so a re-run doesn't re-attempt the same
    // vacancy; the operator can still reach a phone-only entry manually.
    await supabase
      .from("waitlist_entries")
      .update({
        last_notified_at: new Date().toISOString(),
        last_notified_property_id: propertyId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entry.id)
      .eq("organization_id", org.id);
    notified += 1;
  }

  revalidatePath(propPath(propertyId));
  redirect(wlAnchor(propertyId, notified > 0 ? `notified-${notified}` : "nomatch"));
}
