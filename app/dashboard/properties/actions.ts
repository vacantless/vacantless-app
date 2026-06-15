"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { PROPERTY_STATUSES } from "@/lib/pipeline";

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

  const supabase = createClient();
  // RLS scopes the update to the caller's org; .eq("id") targets one row.
  await supabase
    .from("properties")
    .update({
      address,
      rent_cents: parseRentCents(String(formData.get("rent") ?? "")),
      beds: parseIntOrNull(String(formData.get("beds") ?? "")),
      baths: parseFloatOrNull(String(formData.get("baths") ?? "")),
      parking: String(formData.get("parking") ?? "").trim() || null,
      description: String(formData.get("description") ?? "").trim() || null,
      status,
    })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${id}`);
  revalidatePath("/dashboard/properties");
  redirect(`/dashboard/properties/${id}?saved=1`);
}
