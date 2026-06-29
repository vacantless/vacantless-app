"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  isViolationType,
  isViolationLifecycle,
} from "@/lib/lease-violations";

// Lease-violation server actions (S383). Add / edit / remove a violation logged
// against a tenancy. All guarded on manage_tenancies (a violation hangs off a
// tenancy) and redirect-based, surfacing the outcome via ?violation=… on the
// tenancy page (#violations anchor). The tenancy_violations table (0092) is
// org-scoped by RLS; we additionally confirm the tenancy belongs to this org
// before writing, mirroring the insurance actions.

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function tenancyPath(id: string): string {
  return `/dashboard/tenancies/${id}`;
}

const vioAnchor = (id: string, q: string) =>
  `${tenancyPath(id)}?violation=${q}#violations`;

/** Parse 'YYYY-MM-DD' from a date input, or null if blank/malformed. */
function parseDateOrNull(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
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

/** Collect the violation fields shared by add + update from the form, with the
 *  constrained columns (type/status) defaulted to a valid value so a malformed
 *  submit can never hit the DB CHECK. */
function violationFields(formData: FormData) {
  const rawType = s(formData, "violation_type");
  const rawStatus = s(formData, "status");
  return {
    violation_type: isViolationType(rawType) ? rawType : "other",
    occurred_on: parseDateOrNull(s(formData, "occurred_on")),
    description: s(formData, "description") || null,
    notice_type: s(formData, "notice_type") || null,
    notice_served_on: parseDateOrNull(s(formData, "notice_served_on")),
    remedy_due_on: parseDateOrNull(s(formData, "remedy_due_on")),
    status: isViolationLifecycle(rawStatus) ? rawStatus : "open",
    resolved_on: parseDateOrNull(s(formData, "resolved_on")),
    notes: s(formData, "notes") || null,
  };
}

// ---------------------------------------------------------------------------
// Add a violation to a tenancy.
// ---------------------------------------------------------------------------
export async function addViolation(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", vioAnchor(tenancyId, "forbidden"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId))) redirect("/dashboard/tenancies");

  await supabase.from("tenancy_violations").insert({
    organization_id: org.id,
    tenancy_id: tenancyId,
    ...violationFields(formData),
  });

  revalidatePath(tenancyPath(tenancyId));
  redirect(vioAnchor(tenancyId, "added"));
}

// ---------------------------------------------------------------------------
// Update a violation. Editing the remedy deadline (or reopening) naturally
// re-arms the reminder (the followup_nudged_for stamp keys on the old deadline,
// so a new one no longer matches); we also clear the stamp explicitly so a
// correction within the same deadline re-arms cleanly too.
// ---------------------------------------------------------------------------
export async function updateViolation(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!id) redirect(vioAnchor(tenancyId, "notfound"));
  await requireCapability("manage_tenancies", vioAnchor(tenancyId, "forbidden"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId))) redirect("/dashboard/tenancies");

  await supabase
    .from("tenancy_violations")
    .update({ ...violationFields(formData), followup_nudged_for: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenancy_id", tenancyId);

  revalidatePath(tenancyPath(tenancyId));
  redirect(vioAnchor(tenancyId, "updated"));
}

// ---------------------------------------------------------------------------
// Remove a violation.
// ---------------------------------------------------------------------------
export async function removeViolation(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!id) redirect(vioAnchor(tenancyId, "notfound"));
  await requireCapability("manage_tenancies", vioAnchor(tenancyId, "forbidden"));

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId))) redirect("/dashboard/tenancies");

  await supabase
    .from("tenancy_violations")
    .delete()
    .eq("id", id)
    .eq("tenancy_id", tenancyId);

  revalidatePath(tenancyPath(tenancyId));
  redirect(vioAnchor(tenancyId, "removed"));
}
