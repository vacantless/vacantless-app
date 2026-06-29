"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  isInspectionType,
  isInspectionLifecycle,
} from "@/lib/property-inspections";

// Property-inspection server actions (S385). Add / edit / remove an inspection
// scheduled or logged against a tenancy. All guarded on manage_tenancies (an
// inspection hangs off a tenancy) and redirect-based, surfacing the outcome via
// ?inspection=… on the tenancy page (#inspections anchor). The
// tenancy_inspections table (0094) is org-scoped by RLS; we additionally confirm
// the tenancy belongs to this org before writing, mirroring the violation
// actions.

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function tenancyPath(id: string): string {
  return `/dashboard/tenancies/${id}`;
}

const inspAnchor = (id: string, q: string) =>
  `${tenancyPath(id)}?inspection=${q}#inspections`;

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

/** Collect the inspection fields shared by add + update from the form, with the
 *  constrained columns (type/status) defaulted to a valid value so a malformed
 *  submit can never hit the DB CHECK. */
function inspectionFields(formData: FormData) {
  const rawType = s(formData, "inspection_type");
  const rawStatus = s(formData, "status");
  return {
    inspection_type: isInspectionType(rawType) ? rawType : "periodic",
    scheduled_for: parseDateOrNull(s(formData, "scheduled_for")),
    status: isInspectionLifecycle(rawStatus) ? rawStatus : "scheduled",
    completed_on: parseDateOrNull(s(formData, "completed_on")),
    condition_notes: s(formData, "condition_notes") || null,
    notes: s(formData, "notes") || null,
  };
}

// ---------------------------------------------------------------------------
// Add an inspection to a tenancy.
// ---------------------------------------------------------------------------
export async function addInspection(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", inspAnchor(tenancyId, "forbidden"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId))) redirect("/dashboard/tenancies");

  await supabase.from("tenancy_inspections").insert({
    organization_id: org.id,
    tenancy_id: tenancyId,
    ...inspectionFields(formData),
  });

  revalidatePath(tenancyPath(tenancyId));
  redirect(inspAnchor(tenancyId, "added"));
}

// ---------------------------------------------------------------------------
// Update an inspection. Editing the planned date (or rescheduling) naturally
// re-arms the reminder (the reminder_nudged_for stamp keys on the old date, so a
// new one no longer matches); we also clear the stamp explicitly so a correction
// within the same date re-arms cleanly too.
// ---------------------------------------------------------------------------
export async function updateInspection(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!id) redirect(inspAnchor(tenancyId, "notfound"));
  await requireCapability("manage_tenancies", inspAnchor(tenancyId, "forbidden"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId))) redirect("/dashboard/tenancies");

  await supabase
    .from("tenancy_inspections")
    .update({ ...inspectionFields(formData), reminder_nudged_for: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenancy_id", tenancyId);

  revalidatePath(tenancyPath(tenancyId));
  redirect(inspAnchor(tenancyId, "updated"));
}

// ---------------------------------------------------------------------------
// Remove an inspection.
// ---------------------------------------------------------------------------
export async function removeInspection(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!id) redirect(inspAnchor(tenancyId, "notfound"));
  await requireCapability("manage_tenancies", inspAnchor(tenancyId, "forbidden"));

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId))) redirect("/dashboard/tenancies");

  await supabase
    .from("tenancy_inspections")
    .delete()
    .eq("id", id)
    .eq("tenancy_id", tenancyId);

  revalidatePath(tenancyPath(tenancyId));
  redirect(inspAnchor(tenancyId, "removed"));
}
