"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { PROPERTY_STATUSES } from "@/lib/pipeline";
import { pendingDropFrom, leadEligibleForPriceDrop } from "@/lib/price-drop";
import { sendPriceDropAlert } from "@/lib/email";

function parseRentCents(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function parseIntOrNull(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatOrNull(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export async function addProperty(formData: FormData) {
  const address = String(formData.get("address") ?? "").trim();
  if (!address) return;

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  // organization_id is taken from the caller's own org; RLS WITH CHECK also
  // enforces it must be an org they belong to — no cross-tenant write possible.
  await supabase.from("properties").insert({
    organization_id: org.id,
    address,
    rent_cents: parseRentCents(String(formData.get("rent") ?? "")),
    beds: parseIntOrNull(String(formData.get("beds") ?? "")),
    baths: parseFloatOrNull(String(formData.get("baths") ?? "")),
  });

  revalidatePath("/dashboard/properties");
  revalidatePath("/dashboard");
}

export async function updateProperty(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const address = String(formData.get("address") ?? "").trim();
  if (!id || !address) return;

  const statusRaw = String(formData.get("status") ?? "available");
  const status = (PROPERTY_STATUSES as readonly string[]).includes(statusRaw)
    ? statusRaw
    : "available";

  const newRent = parseRentCents(String(formData.get("rent") ?? ""));

  const supabase = createClient();

  // Read the prior rent + pending price-drop state so we can record a genuine
  // reduction (and keep the highest "from" price across successive drops). RLS
  // scopes this to the caller's org.
  const { data: prior } = await supabase
    .from("properties")
    .select("rent_cents, price_drop_pending_cents")
    .eq("id", id)
    .maybeSingle();
  const oldRent = (prior as { rent_cents: number | null } | null)?.rent_cents ?? null;
  const existingPending =
    (prior as { price_drop_pending_cents: number | null } | null)
      ?.price_drop_pending_cents ?? null;
  const nextPending = pendingDropFrom(oldRent, newRent, existingPending);

  // RLS scopes the update to the caller's org; .eq("id") targets one row.
  await supabase
    .from("properties")
    .update({
      address,
      rent_cents: newRent,
      beds: parseIntOrNull(String(formData.get("beds") ?? "")),
      baths: parseFloatOrNull(String(formData.get("baths") ?? "")),
      parking: String(formData.get("parking") ?? "").trim() || null,
      description: String(formData.get("description") ?? "").trim() || null,
      status,
      price_drop_pending_cents: nextPending,
    })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${id}`);
  revalidatePath("/dashboard/properties");
  redirect(`/dashboard/properties/${id}?saved=1`);
}

/**
 * Price-drop blast: email every still-open lead on a property that the rent has
 * dropped, inviting them back to the public listing. Recomputes eligibility
 * server-side (never trusts the client), sends best-effort branded emails, logs
 * each to the lead timeline, stamps the lead so a repeat run is a no-op, then
 * clears the property's pending-drop flag. Redirect-based (dodges the 503 WATCH
 * on revalidate-only server actions).
 */
export async function blastPriceDrop(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();

  const { data: property } = await supabase
    .from("properties")
    .select("id, address, rent_cents, price_drop_pending_cents")
    .eq("id", id)
    .maybeSingle();

  const p = property as {
    id: string;
    address: string | null;
    rent_cents: number | null;
    price_drop_pending_cents: number | null;
  } | null;

  // Nothing to announce unless there's a recorded drop below the current rent.
  if (
    !p ||
    p.rent_cents == null ||
    p.price_drop_pending_cents == null ||
    p.price_drop_pending_cents <= p.rent_cents
  ) {
    redirect(`/dashboard/properties/${id}?blasted=0`);
  }

  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, email, status, price_drop_notified_cents")
    .eq("property_id", id);

  const leadRows = (leads ?? []) as Array<{
    id: string;
    name: string | null;
    email: string | null;
    status: string;
    price_drop_notified_cents: number | null;
  }>;

  let sent = 0;
  for (const lead of leadRows) {
    if (
      !leadEligibleForPriceDrop(
        {
          email: lead.email,
          status: lead.status,
          price_drop_notified_cents: lead.price_drop_notified_cents,
        },
        p.rent_cents,
      )
    ) {
      continue;
    }

    const result = await sendPriceDropAlert({
      lead_id: lead.id,
      property_id: p.id,
      renter_name: lead.name,
      renter_email: lead.email,
      org_name: org.name,
      brand_color: org.brand_color,
      logo_url: org.logo_url,
      reply_to_email: org.reply_to_email,
      property_address: p.address,
      new_rent_cents: p.rent_cents,
      old_rent_cents: p.price_drop_pending_cents,
    });

    if (!result.sent) continue; // best-effort: skip; the lead stays eligible

    // Stamp the lead so a re-run never double-sends, then log the timeline.
    await supabase
      .from("leads")
      .update({ price_drop_notified_cents: p.rent_cents })
      .eq("id", lead.id);

    await supabase.from("messages").insert({
      organization_id: org.id,
      lead_id: lead.id,
      channel: "email",
      direction: "outbound",
      body:
        `Price-drop alert sent to ${lead.email}` +
        (result.subject ? ` — "${result.subject}"` : ""),
    });

    sent++;
  }

  // Clear the pending-drop flag so the blast card retires.
  await supabase
    .from("properties")
    .update({ price_drop_pending_cents: null })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${id}`);
  revalidatePath("/dashboard/leads");
  redirect(`/dashboard/properties/${id}?blasted=${sent}`);
}
