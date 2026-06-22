"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { validateWorkOrderInput } from "@/lib/work-orders";

// Tenancy-scoped "Report an issue" action (work-order module Slice 3). A thin
// wrapper over the same work_orders insert the maintenance page uses, but it
// pre-attaches the tenancy + its property and redirects back to the tenancy
// page so the owner can log a repair from where they're already working.
//
// Guarded on manage_work_orders (owner_admin + operator), same as the
// /dashboard/maintenance actions. We record the work; we never dispatch a trade
// or move money. Full editing (cost, trade assignment, status) happens on the
// maintenance page.

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function tenancyPath(id: string): string {
  return `/dashboard/tenancies/${id}`;
}

export async function reportTenancyIssue(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_work_orders", `${tenancyPath(tenancyId)}?wo=forbidden#maintenance`);

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const check = validateWorkOrderInput({
    title: s(formData, "title"),
    category: s(formData, "category"),
    priority: s(formData, "priority"),
    costCents: null,
  });
  if (!check.ok) redirect(`${tenancyPath(tenancyId)}?wo=${check.code}#maintenance`);

  const supabase = createClient();
  // Confirm the tenancy belongs to this org and grab its property (RLS scopes
  // the read). The work order inherits that property so it rolls up correctly.
  const { data: tRow } = await supabase
    .from("tenancies")
    .select("id, property_id")
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tRow) redirect("/dashboard/tenancies");

  await supabase.from("work_orders").insert({
    organization_id: org.id,
    tenancy_id: tenancyId,
    property_id: (tRow as { property_id: string | null }).property_id,
    title: check.value.title,
    description: s(formData, "description") || null,
    category: check.value.category,
    priority: check.value.priority,
    status: "open",
  });

  revalidatePath(tenancyPath(tenancyId));
  revalidatePath("/dashboard/maintenance");
  redirect(`${tenancyPath(tenancyId)}?wo=reported#maintenance`);
}
