"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { parseAmountToCents, parseDateOrNull } from "@/lib/payments";
import {
  validateWorkOrderInput,
  validateStatusChange,
  validateTradeContactInput,
} from "@/lib/work-orders";

// Maintenance work-order + trade-contact actions (self-managed-owner wedge,
// Slice 2 of the work-order module — see VACANTLESS-WORKORDERS-MODULE-SPEC).
//
// We record the owner's maintenance work; we never dispatch a trade or move
// money. Every action is guarded on the manage_work_orders capability
// (owner_admin + operator). Writes set organization_id from getCurrentOrg and
// rely on the per-org RLS WITH CHECK (migration 0054) as the backstop. Optional
// property/tenancy/trade FKs are confirmed to belong to the caller's org before
// they're stored (RLS scopes the lookups), so a forged id can't attach.
//
// REDIRECT-based, like payment-actions.ts (the S170 revalidate-503 WATCH).

const BASE = "/dashboard/maintenance";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

// "" -> null; otherwise the trimmed value. Used for the optional UUID selects.
function orNull(formData: FormData, name: string): string | null {
  const v = s(formData, name);
  return v === "" ? null : v;
}

// Confirm an optional FK id belongs to the caller's org (RLS scopes the read).
// Returns true when the id is blank (nothing to attach) or it resolves to a row.
async function fkOk(
  supabase: ReturnType<typeof createClient>,
  table: "properties" | "tenancies" | "trade_contacts",
  id: string | null,
): Promise<boolean> {
  if (!id) return true;
  const { data } = await supabase.from(table).select("id").eq("id", id).maybeSingle();
  return !!data;
}

// --- Work orders ------------------------------------------------------------

export async function createWorkOrder(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?wo=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const check = validateWorkOrderInput({
    title: s(formData, "title"),
    category: s(formData, "category"),
    priority: s(formData, "priority"),
    costCents: parseAmountToCents(s(formData, "cost")),
  });
  if (!check.ok) redirect(`${BASE}?wo=${check.code}`);

  const supabase = createClient();
  const propertyId = orNull(formData, "property_id");
  const tenancyId = orNull(formData, "tenancy_id");
  const tradeContactId = orNull(formData, "trade_contact_id");

  if (
    !(await fkOk(supabase, "properties", propertyId)) ||
    !(await fkOk(supabase, "tenancies", tenancyId)) ||
    !(await fkOk(supabase, "trade_contacts", tradeContactId))
  ) {
    redirect(`${BASE}?wo=notfound`);
  }

  // A trade attached at creation means the job is at least "assigned".
  const status = tradeContactId ? "assigned" : "open";

  await supabase.from("work_orders").insert({
    organization_id: org.id,
    property_id: propertyId,
    tenancy_id: tenancyId,
    trade_contact_id: tradeContactId,
    title: check.value.title,
    description: s(formData, "description") || null,
    category: check.value.category,
    priority: check.value.priority,
    status,
    cost_cents: check.value.costCents,
    reported_on: parseDateOrNull(s(formData, "reported_on")) ?? undefined,
    scheduled_for: parseDateOrNull(s(formData, "scheduled_for")),
  });

  revalidatePath(BASE);
  redirect(`${BASE}?wo=created`);
}

export async function updateWorkOrder(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?wo=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const id = s(formData, "id");
  if (!id) redirect(BASE);

  const check = validateWorkOrderInput({
    title: s(formData, "title"),
    category: s(formData, "category"),
    priority: s(formData, "priority"),
    costCents: parseAmountToCents(s(formData, "cost")),
  });
  if (!check.ok) redirect(`${BASE}?wo=${check.code}`);

  const supabase = createClient();
  const propertyId = orNull(formData, "property_id");
  const tenancyId = orNull(formData, "tenancy_id");
  const tradeContactId = orNull(formData, "trade_contact_id");

  if (
    !(await fkOk(supabase, "properties", propertyId)) ||
    !(await fkOk(supabase, "tenancies", tenancyId)) ||
    !(await fkOk(supabase, "trade_contacts", tradeContactId))
  ) {
    redirect(`${BASE}?wo=notfound`);
  }

  // RLS scopes the update to the caller's org. status/completed_on are changed
  // only through setWorkOrderStatus (which validates the lifecycle).
  await supabase
    .from("work_orders")
    .update({
      property_id: propertyId,
      tenancy_id: tenancyId,
      trade_contact_id: tradeContactId,
      title: check.value.title,
      description: s(formData, "description") || null,
      category: check.value.category,
      priority: check.value.priority,
      cost_cents: check.value.costCents,
      scheduled_for: parseDateOrNull(s(formData, "scheduled_for")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath(BASE);
  redirect(`${BASE}?wo=saved`);
}

export async function setWorkOrderStatus(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?wo=forbidden`);

  const id = s(formData, "id");
  const to = s(formData, "status");
  if (!id || !to) redirect(BASE);

  const supabase = createClient();
  const { data: row } = await supabase
    .from("work_orders")
    .select("status, completed_on")
    .eq("id", id)
    .maybeSingle();
  if (!row) redirect(`${BASE}?wo=notfound`);

  // When completing, take the completion date from the form (default today).
  const completedOn =
    to === "completed"
      ? (parseDateOrNull(s(formData, "completed_on")) ??
        new Date().toISOString().slice(0, 10))
      : null;

  const check = validateStatusChange(row.status as string, to, completedOn);
  if (!check.ok) redirect(`${BASE}?wo=${check.code}`);

  await supabase
    .from("work_orders")
    .update({
      status: check.value.status,
      completed_on: check.value.completedOn,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath(BASE);
  redirect(`${BASE}?wo=status`);
}

export async function deleteWorkOrder(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?wo=forbidden`);

  const id = s(formData, "id");
  if (!id) redirect(BASE);

  const supabase = createClient();
  await supabase.from("work_orders").delete().eq("id", id);

  revalidatePath(BASE);
  redirect(`${BASE}?wo=deleted`);
}

// --- Trade contacts (the owner's own vendor rolodex) ------------------------

export async function createTradeContact(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?trade=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const check = validateTradeContactInput({
    name: s(formData, "name"),
    email: s(formData, "email") || null,
  });
  if (!check.ok) redirect(`${BASE}?trade=${check.code}`);

  const supabase = createClient();
  await supabase.from("trade_contacts").insert({
    organization_id: org.id,
    name: check.value.name,
    trade_type: s(formData, "trade_type") || null,
    phone: s(formData, "phone") || null,
    email: check.value.email,
    note: s(formData, "note") || null,
  });

  revalidatePath(BASE);
  redirect(`${BASE}?trade=created#trades`);
}

export async function updateTradeContact(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?trade=forbidden`);

  const id = s(formData, "id");
  if (!id) redirect(BASE);

  const check = validateTradeContactInput({
    name: s(formData, "name"),
    email: s(formData, "email") || null,
  });
  if (!check.ok) redirect(`${BASE}?trade=${check.code}`);

  const supabase = createClient();
  await supabase
    .from("trade_contacts")
    .update({
      name: check.value.name,
      trade_type: s(formData, "trade_type") || null,
      phone: s(formData, "phone") || null,
      email: check.value.email,
      note: s(formData, "note") || null,
    })
    .eq("id", id);

  revalidatePath(BASE);
  redirect(`${BASE}?trade=saved#trades`);
}

// Soft-hide a vendor (archived=true) so it drops out of the picker without
// breaking the cost history of past work orders that referenced it.
export async function archiveTradeContact(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?trade=forbidden`);

  const id = s(formData, "id");
  if (!id) redirect(BASE);
  const archived = s(formData, "archived") === "1";

  const supabase = createClient();
  await supabase.from("trade_contacts").update({ archived }).eq("id", id);

  revalidatePath(BASE);
  redirect(`${BASE}?trade=${archived ? "archived" : "restored"}#trades`);
}
