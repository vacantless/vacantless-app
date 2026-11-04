"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/membership";
import {
  earliestN5TerminationDate,
  n5EarliestL2Date,
  n5FixByDate,
  n5LatestL2Date,
  n5Problems,
  type N5Event,
  type N5ServiceMethod,
  type N5Which,
} from "@/lib/n5";
import { N5_TEMPLATE_VERSION, type N5FillSnapshot } from "@/lib/n5-official-pdf";
import { addDaysISO } from "@/lib/n12";
import { parseAmountToCents, parseDateOrNull } from "@/lib/payments";

// S748g: Form N5 (interfering with others, damage or overcrowding). PREPARE-FIRST:
// Vacantless freezes the landlord's answers into notices.snapshot (type 'N5') and
// fills the official 2026/09 form; the landlord signs and serves it themselves.
// Every write stamps organization_id from the tenancy read under RLS.

export type N5Snapshot = N5FillSnapshot & {
  serviceDateISO: string;
  method: N5ServiceMethod;
  fixByISO: string | null;
  earliestL2ISO: string;
  latestL2ISO: string;
  formVersion: string;
  capturedAtIso: string;
};

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
const anchor = (id: string, q: string) => `/dashboard/tenancies/${id}?n5=${q}#notices`;
const todayOntario = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

export async function prepareN5(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));

  const method = s(formData, "method") as N5ServiceMethod;
  if (!["hand", "mail", "courier"].includes(method)) redirect(anchor(tenancyId, "error"));
  const which: N5Which = s(formData, "which") === "second" ? "second" : "first";
  const serviceDateISO = parseDateOrNull(s(formData, "service_date")) ?? todayOntario();

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tRow } = await supabase
    .from("tenancies")
    .select("id, organization_id, status, property:properties(address), tenants(name, is_primary)")
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tRow) redirect("/dashboard/tenancies");
  const t = tRow as unknown as {
    organization_id: string;
    status: string;
    property: { address: string | null } | null;
    tenants: { name: string | null; is_primary: boolean }[];
  };
  if (t.status !== "active") redirect(anchor(tenancyId, "notready"));

  // A first N5 served in the last 6 months on record (or the landlord confirms one).
  const sixMonthsAgo = addDaysISO(serviceDateISO, -183);
  const { data: priorRows } = await supabase
    .from("notices")
    .select("id, served_at")
    .eq("tenancy_id", tenancyId)
    .eq("type", "N5")
    .in("status", ["served", "filed"])
    .gte("served_at", `${sixMonthsAgo}T00:00:00Z`);
  const firstN5OnFile = (priorRows ?? []).length > 0 || s(formData, "first_confirmed") === "yes";

  const tenantNames = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((x) => (x.name ?? "").trim())
    .filter(Boolean);
  const events: N5Event[] = [1, 2, 3, 4]
    .map((n) => ({ when: s(formData, `event_when_${n}`), details: s(formData, `event_details_${n}`) }))
    .filter((e) => e.when || e.details);
  const reasons = {
    interference: s(formData, "reason_interference") === "yes",
    damage: s(formData, "reason_damage") === "yes",
    overcrowding: s(formData, "reason_overcrowding") === "yes",
  };
  const terminationDateISO =
    parseDateOrNull(s(formData, "termination_date")) ?? earliestN5TerminationDate(serviceDateISO, method, which);
  const maxPeople = s(formData, "max_people") || null;

  const problems = n5Problems({
    serviceDateISO,
    method,
    which,
    terminationDateISO,
    reasons,
    maxPeople,
    events,
    firstN5OnFile,
    tenantNames,
    rentalUnitAddress: t.property?.address ?? null,
  });
  if (problems.length > 0) redirect(anchor(tenancyId, problems[0]));

  const snapshot: N5Snapshot = {
    tenantNames,
    landlordName: s(formData, "landlord_name"),
    rentalUnitAddress: t.property?.address?.trim() || null,
    terminationDateISO,
    which,
    reasons,
    repairCents: parseAmountToCents(s(formData, "repair_cost")),
    replaceCents: parseAmountToCents(s(formData, "replace_cost")),
    maxPeople,
    events,
    signer: {
      firstName: s(formData, "signer_first") || null,
      lastName: s(formData, "signer_last") || null,
      phone: s(formData, "signer_phone") || null,
    },
    serviceDateISO,
    method,
    fixByISO: which === "first" ? n5FixByDate(serviceDateISO, method) : null,
    earliestL2ISO: n5EarliestL2Date(serviceDateISO, method, which),
    latestL2ISO: n5LatestL2Date(terminationDateISO),
    formVersion: N5_TEMPLATE_VERSION,
    capturedAtIso: new Date().toISOString(),
  };

  const { error } = await supabase.from("notices").insert({
    organization_id: t.organization_id,
    tenancy_id: tenancyId,
    type: "N5",
    status: "draft",
    snapshot,
    termination_date: terminationDateISO,
    created_by: user?.id ?? null,
  });
  if (error) redirect(anchor(tenancyId, "error"));
  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "prepared"));
}

export async function recordN5Service(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));
  const noticeId = s(formData, "notice_id");
  const supabase = createClient();
  const { data: n } = await supabase
    .from("notices")
    .select("id, status, type, snapshot")
    .eq("id", noticeId)
    .eq("tenancy_id", tenancyId)
    .maybeSingle();
  const notice = n as { status: string; type: string; snapshot: { method?: string } | null } | null;
  if (!notice || notice.type !== "N5") redirect(anchor(tenancyId, "error"));
  if (notice.status !== "draft") redirect(anchor(tenancyId, "notdraft"));
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("notices")
    .update({ status: "served", served_at: nowIso, served_method: notice.snapshot?.method ?? null, updated_at: nowIso })
    .eq("id", noticeId)
    .eq("status", "draft");
  if (error) redirect(anchor(tenancyId, "error"));
  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "served"));
}

export async function voidN5(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));
  const supabase = createClient();
  const { error } = await supabase
    .from("notices")
    .update({ status: "void", updated_at: new Date().toISOString() })
    .eq("id", s(formData, "notice_id"))
    .eq("tenancy_id", tenancyId)
    .eq("type", "N5");
  if (error) redirect(anchor(tenancyId, "error"));
  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "voided"));
}
