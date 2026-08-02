"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { createClient } from "@/lib/supabase/server";
import {
  buildDefaultUtilityTasks,
  normalizeUtilityTask,
  type UtilityTaskInput,
} from "@/lib/utility-tasks";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function tenancyPath(id: string): string {
  return `/dashboard/tenancies/${id}`;
}

const utilityAnchor = (id: string, q: string) =>
  `${tenancyPath(id)}?utility=${q}#utilities`;

function moveInChecklistEnabled(): boolean {
  return envFlagEnabled(process.env.MOVE_IN_CHECKLIST_ENABLED);
}

function sortOrder(formData: FormData): number {
  const parsed = Number.parseInt(s(formData, "sort_order"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function tenancyInOrg(
  supabase: ReturnType<typeof createClient>,
  tenancyId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("tenancies")
    .select("id, organization_id")
    .eq("id", tenancyId)
    .maybeSingle();
  const row = data as { id: string; organization_id: string } | null;
  return !!row && row.organization_id === orgId;
}

function taskFields(formData: FormData): UtilityTaskInput {
  return {
    label: s(formData, "label"),
    responsible_party: s(formData, "responsible_party"),
    target_date: s(formData, "target_date"),
    status: s(formData, "status"),
    confirmation_note: s(formData, "confirmation_note"),
    sort_order: sortOrder(formData),
  };
}

export async function addUtilityTask(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!moveInChecklistEnabled()) redirect(tenancyPath(tenancyId));

  await requireCapability("manage_tenancies", utilityAnchor(tenancyId, "forbidden"));
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const normalized = normalizeUtilityTask(taskFields(formData));
  if (!normalized) redirect(utilityAnchor(tenancyId, "invalid"));

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId, org.id))) {
    redirect("/dashboard/tenancies");
  }

  await supabase.from("tenancy_utility_tasks").insert({
    organization_id: org.id,
    tenancy_id: tenancyId,
    ...normalized,
    sort_order: sortOrder(formData),
  });

  revalidatePath(tenancyPath(tenancyId));
  redirect(utilityAnchor(tenancyId, "added"));
}

export async function updateUtilityTask(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!moveInChecklistEnabled()) redirect(tenancyPath(tenancyId));
  if (!id) redirect(utilityAnchor(tenancyId, "notfound"));

  await requireCapability("manage_tenancies", utilityAnchor(tenancyId, "forbidden"));
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const normalized = normalizeUtilityTask(taskFields(formData));
  if (!normalized) redirect(utilityAnchor(tenancyId, "invalid"));

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId, org.id))) {
    redirect("/dashboard/tenancies");
  }

  await supabase
    .from("tenancy_utility_tasks")
    .update({
      ...normalized,
      sort_order: sortOrder(formData),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenancy_id", tenancyId)
    .eq("organization_id", org.id);

  revalidatePath(tenancyPath(tenancyId));
  redirect(utilityAnchor(tenancyId, "updated"));
}

export async function removeUtilityTask(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!moveInChecklistEnabled()) redirect(tenancyPath(tenancyId));
  if (!id) redirect(utilityAnchor(tenancyId, "notfound"));

  await requireCapability("manage_tenancies", utilityAnchor(tenancyId, "forbidden"));
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId, org.id))) {
    redirect("/dashboard/tenancies");
  }

  await supabase
    .from("tenancy_utility_tasks")
    .delete()
    .eq("id", id)
    .eq("tenancy_id", tenancyId)
    .eq("organization_id", org.id);

  revalidatePath(tenancyPath(tenancyId));
  redirect(utilityAnchor(tenancyId, "removed"));
}

export async function seedDefaultUtilityTasks(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!moveInChecklistEnabled()) redirect(tenancyPath(tenancyId));

  await requireCapability("manage_tenancies", utilityAnchor(tenancyId, "forbidden"));
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  if (!(await tenancyInOrg(supabase, tenancyId, org.id))) {
    redirect("/dashboard/tenancies");
  }

  const { data: existing } = await supabase
    .from("tenancy_utility_tasks")
    .select("id")
    .eq("organization_id", org.id)
    .eq("tenancy_id", tenancyId)
    .limit(1);
  if ((existing ?? []).length > 0) {
    redirect(utilityAnchor(tenancyId, "exists"));
  }

  const rows = buildDefaultUtilityTasks().map((task) => ({
    organization_id: org.id,
    tenancy_id: tenancyId,
    label: task.label,
    responsible_party: task.responsible_party ?? "tenant",
    target_date: task.target_date ?? null,
    status: task.status ?? "todo",
    confirmation_note: task.confirmation_note ?? null,
    sort_order: task.sort_order ?? 0,
  }));
  await supabase.from("tenancy_utility_tasks").insert(rows);

  revalidatePath(tenancyPath(tenancyId));
  redirect(utilityAnchor(tenancyId, "seeded"));
}
