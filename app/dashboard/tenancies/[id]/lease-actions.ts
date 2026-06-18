"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { formatRentCents } from "@/lib/tenancy";
import {
  resolveCurrentClauses,
  buildLeaseVars,
  assembleClauses,
  buildExecutedSnapshot,
  type ClauseRowLike,
  type ClauseVersionRowLike,
} from "@/lib/clauses";

// Generate a lease document for a tenancy (lease vault #11, slice 2). Assembles
// the org's CURRENT clause versions for a residential lease, interpolates the
// tenancy/unit values, and writes a lease_documents row that SNAPSHOTS exactly
// which clause version was in force — the anchor the renewal diff reads against.
// Guarded on manage_tenancies (it acts on a specific tenancy). Redirect-based.

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function generateLease(formData: FormData) {
  await requireCapability(
    "manage_tenancies",
    "/dashboard/tenancies?forbidden=1",
  );
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  const back = `/dashboard/tenancies/${tenancyId}`;

  const supabase = createClient();

  // The tenancy + unit + primary tenant supply the merge-field values.
  const { data: tenancyRow } = await supabase
    .from("tenancies")
    .select(
      "id, rent_cents, deposit_cents, start_date, end_date, property:properties(address), tenants(name, is_primary)",
    )
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tenancyRow) redirect(`${back}?lease=notfound`);
  const tenancy = tenancyRow as unknown as {
    id: string;
    rent_cents: number | null;
    deposit_cents: number | null;
    start_date: string | null;
    end_date: string | null;
    property: { address: string } | null;
    tenants: { name: string | null; is_primary: boolean }[];
  };
  const primary =
    (tenancy.tenants ?? []).find((t) => t.is_primary) ??
    (tenancy.tenants ?? [])[0] ??
    null;

  // The org clause library (current versions only get assembled).
  const { data: clauseRows } = await supabase
    .from("lease_clauses")
    .select("id, key, title, applicable_to")
    .order("category", { ascending: true })
    .order("key", { ascending: true });
  const { data: versionRows } = await supabase
    .from("lease_clause_versions")
    .select("id, clause_id, version, is_current, body");

  const resolved = resolveCurrentClauses(
    (clauseRows ?? []) as ClauseRowLike[],
    (versionRows ?? []) as ClauseVersionRowLike[],
  );
  if (resolved.length === 0) redirect(`${back}?lease=noclauses`);

  const vars = buildLeaseVars({
    propertyAddress: tenancy.property?.address ?? null,
    tenantName: primary?.name ?? null,
    rent: tenancy.rent_cents != null ? formatRentCents(tenancy.rent_cents) : null,
    deposit:
      tenancy.deposit_cents != null ? formatRentCents(tenancy.deposit_cents) : null,
    startDate: tenancy.start_date,
    endDate: tenancy.end_date,
    // Operator-supplied per-tenancy fields (optional; unfilled ones stay visible
    // as {{token}} in the draft so nothing is silently blanked).
    parkingSpaces: s(formData, "parking_spaces") || null,
    parkingFee: s(formData, "parking_fee") || null,
    tenantUtilities: s(formData, "tenant_utilities") || null,
    includedUtilities: s(formData, "included_utilities") || null,
    storageDescription: s(formData, "storage_description") || null,
  });

  const result = assembleClauses(resolved, { leaseType: "residential", vars });
  const snapshot = buildExecutedSnapshot(result);

  const { error } = await supabase.from("lease_documents").insert({
    organization_id: org.id,
    tenancy_id: tenancyId,
    title: "Residential Lease",
    status: "draft",
    assembled_body: result.text,
    executed_clause_versions: snapshot,
  });
  if (error) redirect(`${back}?lease=error`);

  revalidatePath(back);
  redirect(`${back}?lease=generated`);
}

// Delete a generated lease draft.
export async function deleteLeaseDocument(formData: FormData) {
  await requireCapability(
    "manage_tenancies",
    "/dashboard/tenancies?forbidden=1",
  );
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "lease_id");
  const back = `/dashboard/tenancies/${tenancyId}`;
  if (!id) redirect(back);

  const supabase = createClient();
  const { error } = await supabase.from("lease_documents").delete().eq("id", id);
  if (error) redirect(`${back}?lease=error`);

  revalidatePath(back);
  redirect(`${back}?lease=deleted`);
}
