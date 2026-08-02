"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { createClient } from "@/lib/supabase/server";
import {
  buildDefaultChecklistItems,
  normalizeChecklistItem,
  type ChecklistItemInput,
} from "@/lib/inspection-checklist";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function tenancyPath(id: string): string {
  return `/dashboard/tenancies/${id}`;
}

const checklistAnchor = (id: string, q: string) =>
  `${tenancyPath(id)}?checklist=${q}#inspections`;

function moveInChecklistEnabled(): boolean {
  return envFlagEnabled(process.env.MOVE_IN_CHECKLIST_ENABLED);
}

function sortOrder(formData: FormData): number {
  const parsed = Number.parseInt(s(formData, "sort_order"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function inspectionInOrg(
  supabase: ReturnType<typeof createClient>,
  inspectionId: string,
  orgId: string,
): Promise<{ id: string; tenancy_id: string; organization_id: string } | null> {
  const { data } = await supabase
    .from("tenancy_inspections")
    .select("id, tenancy_id, organization_id")
    .eq("id", inspectionId)
    .maybeSingle();
  const row = data as
    | { id: string; tenancy_id: string; organization_id: string }
    | null;
  if (!row || row.organization_id !== orgId) return null;
  return row;
}

function checklistFields(formData: FormData): ChecklistItemInput {
  return {
    area: s(formData, "area"),
    item: s(formData, "item"),
    condition: s(formData, "condition"),
    note: s(formData, "note"),
    sort_order: sortOrder(formData),
  };
}

export async function addChecklistItem(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const inspectionId = s(formData, "inspection_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!moveInChecklistEnabled()) redirect(tenancyPath(tenancyId));
  if (!inspectionId) redirect(checklistAnchor(tenancyId, "notfound"));

  await requireCapability("manage_tenancies", checklistAnchor(tenancyId, "forbidden"));
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const normalized = normalizeChecklistItem(checklistFields(formData));
  if (!normalized) redirect(checklistAnchor(tenancyId, "invalid"));

  const supabase = createClient();
  const inspection = await inspectionInOrg(supabase, inspectionId, org.id);
  if (!inspection || inspection.tenancy_id !== tenancyId) {
    redirect(checklistAnchor(tenancyId, "notfound"));
  }

  await supabase.from("inspection_checklist_items").insert({
    organization_id: org.id,
    inspection_id: inspectionId,
    ...normalized,
    sort_order: sortOrder(formData),
  });

  revalidatePath(tenancyPath(tenancyId));
  redirect(checklistAnchor(tenancyId, "added"));
}

export async function updateChecklistItem(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const inspectionId = s(formData, "inspection_id");
  const id = s(formData, "id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!moveInChecklistEnabled()) redirect(tenancyPath(tenancyId));
  if (!inspectionId || !id) redirect(checklistAnchor(tenancyId, "notfound"));

  await requireCapability("manage_tenancies", checklistAnchor(tenancyId, "forbidden"));
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const normalized = normalizeChecklistItem(checklistFields(formData));
  if (!normalized) redirect(checklistAnchor(tenancyId, "invalid"));

  const supabase = createClient();
  const inspection = await inspectionInOrg(supabase, inspectionId, org.id);
  if (!inspection || inspection.tenancy_id !== tenancyId) {
    redirect(checklistAnchor(tenancyId, "notfound"));
  }

  await supabase
    .from("inspection_checklist_items")
    .update({
      ...normalized,
      sort_order: sortOrder(formData),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("inspection_id", inspectionId)
    .eq("organization_id", org.id);

  revalidatePath(tenancyPath(tenancyId));
  redirect(checklistAnchor(tenancyId, "updated"));
}

export async function removeChecklistItem(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const inspectionId = s(formData, "inspection_id");
  const id = s(formData, "id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!moveInChecklistEnabled()) redirect(tenancyPath(tenancyId));
  if (!inspectionId || !id) redirect(checklistAnchor(tenancyId, "notfound"));

  await requireCapability("manage_tenancies", checklistAnchor(tenancyId, "forbidden"));
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  const inspection = await inspectionInOrg(supabase, inspectionId, org.id);
  if (!inspection || inspection.tenancy_id !== tenancyId) {
    redirect(checklistAnchor(tenancyId, "notfound"));
  }

  await supabase
    .from("inspection_checklist_items")
    .delete()
    .eq("id", id)
    .eq("inspection_id", inspectionId)
    .eq("organization_id", org.id);

  revalidatePath(tenancyPath(tenancyId));
  redirect(checklistAnchor(tenancyId, "removed"));
}

export async function seedDefaultChecklist(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const inspectionId = s(formData, "inspection_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  if (!moveInChecklistEnabled()) redirect(tenancyPath(tenancyId));
  if (!inspectionId) redirect(checklistAnchor(tenancyId, "notfound"));

  await requireCapability("manage_tenancies", checklistAnchor(tenancyId, "forbidden"));
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  const inspection = await inspectionInOrg(supabase, inspectionId, org.id);
  if (!inspection || inspection.tenancy_id !== tenancyId) {
    redirect(checklistAnchor(tenancyId, "notfound"));
  }

  const { data: existing } = await supabase
    .from("inspection_checklist_items")
    .select("id")
    .eq("organization_id", org.id)
    .eq("inspection_id", inspectionId)
    .limit(1);
  if ((existing ?? []).length > 0) {
    redirect(checklistAnchor(tenancyId, "exists"));
  }

  const rows = buildDefaultChecklistItems().map((item) => ({
    organization_id: org.id,
    inspection_id: inspectionId,
    area: item.area ?? null,
    item: item.item,
    condition: item.condition ?? null,
    note: item.note ?? null,
    sort_order: item.sort_order ?? 0,
  }));
  await supabase.from("inspection_checklist_items").insert(rows);

  revalidatePath(tenancyPath(tenancyId));
  redirect(checklistAnchor(tenancyId, "seeded"));
}
