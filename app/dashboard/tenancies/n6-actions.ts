"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/membership";
import {
  earliestN6TerminationDate,
  n6EarliestL2Date,
  n6Problems,
  type N6Event,
  type N6ServiceMethod,
  type N6Which,
} from "@/lib/n6";
import { N6_TEMPLATE_VERSION, type N6FillSnapshot } from "@/lib/n6-official-pdf";
import { addDaysISO } from "@/lib/n12";
import { parseDateOrNull } from "@/lib/payments";

// S751: Form N6 (illegal acts, or misrepresenting income in rent-geared-to-income
// housing). PREPARE-FIRST like the N5: Vacantless freezes the landlord's answers
// into notices.snapshot (type 'N6') and fills the official 2026/09 form; the
// landlord signs and serves it themselves. Every write stamps organization_id
// from the tenancy read under RLS; manage_tenancies gates every action.

export type N6Snapshot = N6FillSnapshot & {
  serviceDateISO: string;
  method: N6ServiceMethod;
  which: N6Which;
  earliestL2ISO: string;
  formVersion: string;
  capturedAtIso: string;
};

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
const anchor = (id: string, q: string) => `/dashboard/tenancies/${id}?n6=${q}#notices`;
const todayOntario = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

export async function prepareN6(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));

  const method = s(formData, "method") as N6ServiceMethod;
  if (!["hand", "mail", "courier"].includes(method)) redirect(anchor(tenancyId, "error"));
  const which: N6Which = s(formData, "which") === "second" ? "second" : "first";
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

  // The 14-day rule: a first N5 (7 days to fix) served in the last 6 months, on record or confirmed.
  const sixMonthsAgo = addDaysISO(serviceDateISO, -183);
  const { data: priorRows } = await supabase
    .from("notices")
    .select("id, served_at, snapshot")
    .eq("tenancy_id", tenancyId)
    .eq("type", "N5")
    .in("status", ["served", "filed"])
    .gte("served_at", `${sixMonthsAgo}T00:00:00Z`);
  const firstN5OnFile =
    (priorRows ?? []).some((r) => (r as { snapshot: { which?: string } | null }).snapshot?.which !== "second") ||
    s(formData, "first_confirmed") === "yes";

  const tenantNames = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((x) => (x.name ?? "").trim())
    .filter(Boolean);
  const events: N6Event[] = [1, 2, 3, 4]
    .map((n) => ({ when: s(formData, `event_when_${n}`).slice(0, 300), details: s(formData, `event_details_${n}`).slice(0, 3000) }))
    .filter((e) => e.when || e.details);
  const reasons = {
    drugs: s(formData, "reason_drugs") === "yes",
    illegal: s(formData, "reason_illegal") === "yes",
    income: s(formData, "reason_income") === "yes",
  };
  const terminationDateISO =
    parseDateOrNull(s(formData, "termination_date")) ?? earliestN6TerminationDate(serviceDateISO, method, reasons, which);

  const problems = n6Problems({
    serviceDateISO,
    method,
    which,
    terminationDateISO,
    reasons,
    events,
    firstN5OnFile,
    tenantNames,
    rentalUnitAddress: t.property?.address ?? null,
  });
  if (problems.length > 0) redirect(anchor(tenancyId, problems[0]));

  const snapshot: N6Snapshot = {
    tenantNames,
    landlordName: s(formData, "landlord_name"),
    rentalUnitAddress: t.property?.address?.trim() || null,
    terminationDateISO,
    reasons,
    events,
    signer: {
      firstName: s(formData, "signer_first") || null,
      lastName: s(formData, "signer_last") || null,
      phone: s(formData, "signer_phone") || null,
    },
    serviceDateISO,
    method,
    which,
    earliestL2ISO: n6EarliestL2Date(serviceDateISO, method),
    formVersion: N6_TEMPLATE_VERSION,
    capturedAtIso: new Date().toISOString(),
  };

  const { error } = await supabase.from("notices").insert({
    organization_id: t.organization_id,
    tenancy_id: tenancyId,
    type: "N6",
    status: "draft",
    snapshot,
    termination_date: terminationDateISO,
    created_by: user?.id ?? null,
  });
  if (error) redirect(anchor(tenancyId, "error"));
  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "prepared"));
}

export async function recordN6Service(formData: FormData) {
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
  if (!notice || notice.type !== "N6") redirect(anchor(tenancyId, "error"));
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

export async function voidN6(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));
  const supabase = createClient();
  const { error } = await supabase
    .from("notices")
    .update({ status: "void", updated_at: new Date().toISOString() })
    .eq("id", s(formData, "notice_id"))
    .eq("tenancy_id", tenancyId)
    .eq("type", "N6");
  if (error) redirect(anchor(tenancyId, "error"));
  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "voided"));
}
