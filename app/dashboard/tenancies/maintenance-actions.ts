"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { validateWorkOrderInput } from "@/lib/work-orders";
import { canUseIncidentIntake } from "@/lib/billing";
import { generateReportToken } from "@/lib/incident-reports";

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

// Mint (idempotently) the per-tenancy tenant report link (Option B Slice 2 —
// tenant tokenized intake). The operator shares this stable link with the
// tenant, who reports maintenance issues via the account-less /report/[token]
// page. Generating it once stores the token on the tenancy; re-running is a
// no-op (the existing token is kept) so the link the tenant has never breaks.
//
// Gated server-side on the `incident_intake` entitlement (Growth+) — the clean
// enforcement point for the feature gate. Capability: manage_tenancies (the
// person who manages the tenancy controls who can report against it).
export async function generateTenantReportLink(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", `${tenancyPath(tenancyId)}?report=forbidden#maintenance`);

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!canUseIncidentIntake(org.plan)) {
    redirect(`${tenancyPath(tenancyId)}?report=locked#maintenance`);
  }

  const supabase = createClient();
  const { data: tRow } = await supabase
    .from("tenancies")
    .select("id, report_token")
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tRow) redirect("/dashboard/tenancies");

  // Idempotent: only mint a token if none exists yet.
  if (!(tRow as { report_token: string | null }).report_token) {
    await supabase
      .from("tenancies")
      .update({ report_token: generateReportToken() })
      .eq("id", tenancyId);
  }

  revalidatePath(tenancyPath(tenancyId));
  redirect(`${tenancyPath(tenancyId)}?report=ready#maintenance`);
}
