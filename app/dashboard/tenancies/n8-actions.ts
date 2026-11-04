"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/membership";
import { countableLatePeriods, earliestN8TerminationDate, findLatePeriods, n8Problems, type N8LatePeriod, type N8ServiceMethod } from "@/lib/n8";
import { N8_TEMPLATE_VERSION, type N8FillSnapshot } from "@/lib/n8-official-pdf";
import { parseDateOrNull } from "@/lib/payments";

// S749: Form N8 (persistent late rent). PREPARE-FIRST, like the N12: Vacantless
// counts the late payments from the rent ledger, freezes the landlord's reviewed
// answers into notices.snapshot (type 'N8') and fills the official 2026/09 form
// for the landlord to sign and serve themselves. Nothing is served for them.
// SECURITY: every write stamps organization_id from the tenancy read under RLS,
// never from the client; manage_tenancies gates every action.

export type N8Snapshot = N8FillSnapshot & {
  serviceDateISO: string;
  method: N8ServiceMethod;
  dueDay: number;
  fixedTermEndISO: string | null;
  earliestTerminationISO: string;
  latePeriods: N8LatePeriod[];
  formVersion: string;
  capturedAtIso: string;
};

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
const anchor = (id: string, q: string) => `/dashboard/tenancies/${id}?n8=${q}#notices`;
const todayOntario = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

export async function prepareN8(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));

  const method = s(formData, "method") as N8ServiceMethod;
  if (!["hand", "mail", "courier"].includes(method)) redirect(anchor(tenancyId, "badmethod"));
  const dueDayRaw = Number(s(formData, "due_day") || "1");
  const dueDay = Number.isInteger(dueDayRaw) && dueDayRaw >= 1 && dueDayRaw <= 31 ? dueDayRaw : 1;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tRow } = await supabase
    .from("tenancies")
    .select("id, organization_id, status, rent_cents, end_date, property:properties(address), tenants(name, is_primary)")
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tRow) redirect("/dashboard/tenancies");
  const t = tRow as unknown as {
    id: string;
    organization_id: string;
    status: string;
    rent_cents: number | null;
    end_date: string | null;
    property: { address: string | null } | null;
    tenants: { name: string | null; is_primary: boolean }[];
  };
  if (t.status !== "active" || !t.rent_cents) redirect(anchor(tenancyId, "notready"));

  const serviceDateISO = parseDateOrNull(s(formData, "service_date")) ?? todayOntario();
  const { data: payRows } = await supabase
    .from("rent_payments")
    .select("amount_cents, period_month, paid_on")
    .eq("tenancy_id", tenancyId)
    .gte("period_month", new Date(Date.parse(serviceDateISO) - 220 * 86_400_000).toISOString().slice(0, 10))
    .limit(500);
  const late = findLatePeriods({
    rentCents: t.rent_cents as number,
    payments: (payRows ?? []) as { amount_cents: number; period_month: string | null; paid_on: string | null }[],
    asOfISO: serviceDateISO,
    dueDay,
  });

  const fixedTermEndISO = t.end_date && t.end_date >= serviceDateISO ? t.end_date : null;
  const dateInput = { serviceDateISO, method, dueDay, fixedTermEndISO };
  const earliest = earliestN8TerminationDate(dateInput);
  const terminationDateISO = parseDateOrNull(s(formData, "termination_date")) ?? earliest;
  const tenantNames = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((x) => (x.name ?? "").trim())
    .filter(Boolean);
  const details = String(formData.get("details") ?? "").replace(/\r\n/g, "\n").trim();
  const rentalUnitAddress = t.property?.address?.trim() || null;

  const problems = n8Problems({ ...dateInput, terminationDateISO, lateCount: countableLatePeriods(late).length, details, tenantNames, rentalUnitAddress });
  if (problems.length > 0) redirect(anchor(tenancyId, problems[0]));

  const snapshot: N8Snapshot = {
    tenantNames,
    landlordName: s(formData, "landlord_name"),
    rentalUnitAddress,
    terminationDateISO,
    details,
    signer: {
      firstName: s(formData, "signer_first") || null,
      lastName: s(formData, "signer_last") || null,
      phone: s(formData, "signer_phone") || null,
    },
    serviceDateISO,
    method,
    dueDay,
    fixedTermEndISO,
    earliestTerminationISO: earliest,
    latePeriods: late,
    formVersion: N8_TEMPLATE_VERSION,
    capturedAtIso: new Date().toISOString(),
  };

  const { error } = await supabase.from("notices").insert({
    organization_id: t.organization_id,
    tenancy_id: tenancyId,
    type: "N8",
    status: "draft",
    snapshot,
    termination_date: terminationDateISO,
    created_by: user?.id ?? null,
  });
  if (error) redirect(anchor(tenancyId, "error"));

  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "prepared"));
}

export async function recordN8Service(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));
  const noticeId = s(formData, "notice_id");
  if (!noticeId) redirect(anchor(tenancyId, "error"));

  const supabase = createClient();
  const { data: n } = await supabase
    .from("notices")
    .select("id, status, type, snapshot")
    .eq("id", noticeId)
    .eq("tenancy_id", tenancyId)
    .maybeSingle();
  const notice = n as { status: string; type: string; snapshot: { method?: string } | null } | null;
  if (!notice || notice.type !== "N8") redirect(anchor(tenancyId, "error"));
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

export async function voidN8(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));
  const noticeId = s(formData, "notice_id");
  if (!noticeId) redirect(anchor(tenancyId, "error"));

  const supabase = createClient();
  const { error } = await supabase
    .from("notices")
    .update({ status: "void", updated_at: new Date().toISOString() })
    .eq("id", noticeId)
    .eq("tenancy_id", tenancyId)
    .eq("type", "N8");
  if (error) redirect(anchor(tenancyId, "error"));
  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "voided"));
}
