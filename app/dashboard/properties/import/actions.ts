"use server";

// S799d: add several rentals at once. The page previews the rows in the
// browser; this action reads the same pasted text again on the server, so what
// is saved never depends on what the browser claimed.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { isAnyPaidPlan } from "@/lib/billing";
import { normalizePhoneE164 } from "@/lib/sms";
import { resolvePersonId } from "@/lib/persons-server";
import { parseBulkRentals } from "@/lib/bulk-rentals";

const PAGE = "/dashboard/properties/import";
const MAX_TEXT = 300_000;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function importRentals(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const text = String(formData.get("rows_text") ?? "").slice(0, MAX_TEXT);
  if (!text.trim()) redirect(`${PAGE}?err=empty`);

  const supabase = createClient();
  const { data: existing } = await supabase
    .from("properties")
    .select("address")
    .eq("organization_id", org.id)
    .is("archived_at", null);
  const existingAddresses = ((existing ?? []) as { address: string | null }[])
    .map((p) => p.address ?? "")
    .filter(Boolean);

  const parsed = parseBulkRentals(text, { existingAddresses });
  const good = parsed.rows.filter((r) => r.problems.length === 0 && r.address);
  const skipped = parsed.rows.length - good.length;
  if (good.length === 0) redirect(`${PAGE}?err=none&skipped=${skipped}`);

  // The paid rental limit (organizations.rental_cap, S779). Null means no
  // limit. Free has no limit here: its rule is one LIVE rental, and nothing
  // this page saves is live. Rows past the limit are left out and counted.
  let room = good.length;
  if (isAnyPaidPlan(org.plan)) {
    const { data: capRow, error: capErr } = await supabase
      .from("organizations")
      .select("rental_cap")
      .eq("id", org.id)
      .maybeSingle();
    const cap = capErr ? null : ((capRow as { rental_cap?: number | null } | null)?.rental_cap ?? null);
    if (cap != null) room = Math.max(0, cap - existingAddresses.length);
  }
  const toSave = good.slice(0, room);
  const over = good.length - toSave.length;
  if (toSave.length === 0) redirect(`${PAGE}?err=full&over=${over}`);

  // Tenancies need their own permission. Without it the rentals still save.
  const wantsTenancies = toSave.some((r) => r.tenantName && r.leaseStart);
  if (wantsTenancies) await requireCapability("manage_tenancies", `${PAGE}?err=forbidden`);

  const today = todayIso();
  let saved = 0;
  let tenancies = 0;
  let failed = 0;

  for (const r of toSave) {
    const { data: inserted, error } = await supabase
      .from("properties")
      .insert({
        organization_id: org.id,
        // A rental with a tenant is leased. One without is a private draft.
        // Neither is public, and no ad is posted from this page.
        status: r.tenantName ? "leased" : "draft",
        address: r.address,
        rent_cents: r.rentCents,
        beds: r.beds == null ? null : Math.floor(r.beds),
        baths: r.baths,
      })
      .select("id")
      .maybeSingle();
    const propertyId = (inserted as { id: string } | null)?.id ?? null;
    if (error || !propertyId) {
      failed++;
      continue;
    }
    saved++;

    if (!r.tenantName || !r.leaseStart) continue;
    const { data: ten, error: tenErr } = await supabase
      .from("tenancies")
      .insert({
        organization_id: org.id,
        property_id: propertyId,
        rent_cents: r.rentCents,
        start_date: r.leaseStart,
        end_date: r.leaseEnd,
        status: r.leaseStart > today ? "upcoming" : "active",
        last_rent_increase_date: null,
      })
      .select("id")
      .maybeSingle();
    const tenancyId = (ten as { id: string } | null)?.id ?? null;
    if (tenErr || !tenancyId) continue;
    tenancies++;

    const phone_e164 = normalizePhoneE164(r.tenantPhone);
    const personId = await resolvePersonId(supabase, org.id, {
      name: r.tenantName,
      email: r.tenantEmail,
      phone: r.tenantPhone,
      phone_e164,
    });
    await supabase.from("tenants").insert({
      organization_id: org.id,
      tenancy_id: tenancyId,
      name: r.tenantName,
      email: r.tenantEmail,
      phone: r.tenantPhone,
      phone_e164,
      is_primary: true,
      person_id: personId,
    });
  }

  revalidatePath("/dashboard/properties");
  revalidatePath("/dashboard/tenancies");
  revalidatePath("/dashboard");
  redirect(
    `${PAGE}?saved=${saved}&tenancies=${tenancies}&skipped=${skipped}&over=${over}&failed=${failed}`,
  );
}
