"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";

// Renter's-insurance server actions (S382). Add / edit / remove a policy logged
// against a tenancy. All guarded on manage_tenancies (insurance hangs off a
// tenancy) and redirect-based, surfacing the outcome via ?insurance=… on the
// tenancy page (#insurance anchor). The tenancy_insurance table (0091) is
// org-scoped by RLS; we additionally confirm the tenancy belongs to this org
// before writing, mirroring the document-vault actions.

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function tenancyPath(id: string): string {
  return `/dashboard/tenancies/${id}`;
}

const insAnchor = (id: string, q: string) =>
  `${tenancyPath(id)}?insurance=${q}#insurance`;

/** Parse 'YYYY-MM-DD' from a date input, or null if blank/malformed. */
function parseDateOrNull(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Parse a dollar amount (e.g. "1000000" or "1,000,000" or "$1,000,000.00") to
 *  integer cents, or null if blank/unparseable/negative. */
function parseCoverageCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return null;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

/** Confirm the tenancy is in the caller's org (RLS scopes the read). */
async function tenancyInOrg(
  supabase: ReturnType<typeof createClient>,
  tenancyId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("tenancies")
    .select("id")
    .eq("id", tenancyId)
    .maybeSingle();
  return !!data;
}

/** Collect the policy fields shared by add + update from the form. */
function policyFields(formData: FormData) {
  return {
    provider: s(formData, "provider") || null,
    policy_number: s(formData, "policy_number") || null,
    coverage_amount_cents: parseCoverageCents(s(formData, "coverage_amount")),
    effective_date: parseDateOrNull(s(formData, "effective_date")),
    expiry_date: parseDateOrNull(s(formData, "expiry_date")),
    notes: s(formData, "notes") || null,
  };
}

// ---------------------------------------------------------------------------
// Add a policy to a tenancy.
// ---------------------------------------------------------------------------
export async function addInsurance(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", insAnchor(tenancyId, "forbidden"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId))) redirect("/dashboard/tenancies");

  await supabase.from("tenancy_insurance").insert({
    organization_id: org.id,
    tenancy_id: tenancyId,
    ...policyFields(formData),
  });

  revalidatePath(tenancyPath(tenancyId));
  redirect(insAnchor(tenancyId, "added"));
}

// ---------------------------------------------------------------------------
// Update a policy. Editing the expiry date naturally re-arms the reminder (the
// lapse_nudged_for stamp keys on the old expiry, so a new expiry no longer
// matches); we also clear the stamp explicitly so a correction within the same
// term re-arms cleanly too.
// ---------------------------------------------------------------------------
export async function updateInsurance(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!id) redirect(insAnchor(tenancyId, "notfound"));
  await requireCapability("manage_tenancies", insAnchor(tenancyId, "forbidden"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId))) redirect("/dashboard/tenancies");

  await supabase
    .from("tenancy_insurance")
    .update({ ...policyFields(formData), lapse_nudged_for: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenancy_id", tenancyId);

  revalidatePath(tenancyPath(tenancyId));
  redirect(insAnchor(tenancyId, "updated"));
}

// ---------------------------------------------------------------------------
// Remove a policy.
// ---------------------------------------------------------------------------
export async function removeInsurance(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!id) redirect(insAnchor(tenancyId, "notfound"));
  await requireCapability("manage_tenancies", insAnchor(tenancyId, "forbidden"));

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId))) redirect("/dashboard/tenancies");

  await supabase
    .from("tenancy_insurance")
    .delete()
    .eq("id", id)
    .eq("tenancy_id", tenancyId);

  revalidatePath(tenancyPath(tenancyId));
  redirect(insAnchor(tenancyId, "removed"));
}
