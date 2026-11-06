"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/membership";
import { buildN12Snapshot } from "@/lib/n12-snapshot";
import { N12_RELATIONSHIPS, type N12Relationship, type N12ServiceMethod } from "@/lib/n12";
import { N12_TEMPLATE_VERSION } from "@/lib/n12-official-pdf";
import { parseDateOrNull } from "@/lib/payments";
import { fixedTermEndISO } from "@/lib/tenancy";

// S748g: Form N12 (landlord, purchaser or family member requires the unit).
// PREPARE-FIRST, like the N4: Vacantless freezes the landlord's reviewed answers
// into notices.snapshot (type 'N12') and fills the official 2026/10 form for the
// landlord to sign and serve themselves. Nothing is served on their behalf.
// SECURITY: every write stamps organization_id from the tenancy read under RLS,
// never from the client; manage_tenancies gates every action.

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

const anchor = (id: string, q: string) => `/dashboard/tenancies/${id}?n12=${q}#notices`;

function todayOntario(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

export async function prepareN12(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", anchor(tenancyId, "forbidden"));

  const method = s(formData, "method") as N12ServiceMethod;
  if (!["hand", "mail", "courier"].includes(method)) redirect(anchor(tenancyId, "badmethod"));
  const reason = s(formData, "reason") === "2" ? 2 : 1;
  const relationship = s(formData, "relationship") as N12Relationship;
  if (!N12_RELATIONSHIPS.includes(relationship)) redirect(anchor(tenancyId, "no_person"));
  const dueDayRaw = Number(s(formData, "due_day") || "1");
  const dueDay = Number.isInteger(dueDayRaw) && dueDayRaw >= 1 && dueDayRaw <= 31 ? dueDayRaw : 1;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tRow } = await supabase
    .from("tenancies")
    .select("id, organization_id, status, rent_cents, start_date, end_date, term_months, property:properties(address), tenants(name, is_primary)")
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tRow) redirect("/dashboard/tenancies");
  const t = tRow as unknown as {
    id: string;
    organization_id: string;
    status: string;
    rent_cents: number | null;
    start_date: string | null;
    end_date: string | null;
    term_months: number | null;
    property: { address: string | null } | null;
    tenants: { name: string | null; is_primary: boolean }[];
  };
  if (t.status !== "active") redirect(anchor(tenancyId, "notready"));

  const serviceDateISO = parseDateOrNull(s(formData, "service_date")) ?? todayOntario();
  // A fixed term only matters while it is still running on the service date.
  const termEnd = fixedTermEndISO(t);
  const runningTermEnd = termEnd && termEnd >= serviceDateISO ? termEnd : null;
  const tenantNames = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((x) => (x.name ?? "").trim())
    .filter(Boolean);

  const { snapshot, problems } = buildN12Snapshot({
    tenantNames,
    landlordName: s(formData, "landlord_name"),
    landlordIsIndividual: s(formData, "landlord_individual") === "yes",
    rentalUnitAddress: t.property?.address?.trim() || null,
    serviceDateISO,
    method,
    dueDay,
    fixedTermEndISO: runningTermEnd,
    terminationDateISO: parseDateOrNull(s(formData, "termination_date")),
    reason,
    personName: s(formData, "person_name"),
    relationship,
    careProvider: s(formData, "care") === "yes",
    signer: {
      firstName: s(formData, "signer_first") || null,
      lastName: s(formData, "signer_last") || null,
      phone: s(formData, "signer_phone") || null,
    },
    rentCents: t.rent_cents,
    formVersion: N12_TEMPLATE_VERSION,
    capturedAtIso: new Date().toISOString(),
  });
  if (problems.length > 0) redirect(anchor(tenancyId, problems[0]));

  const { error } = await supabase.from("notices").insert({
    organization_id: t.organization_id,
    tenancy_id: tenancyId,
    type: "N12",
    status: "draft",
    snapshot,
    termination_date: snapshot.terminationDateISO,
    total_owing_cents: snapshot.compensationCents,
    created_by: user?.id ?? null,
  });
  if (error) redirect(anchor(tenancyId, "error"));

  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "prepared"));
}

export async function recordN12Service(formData: FormData) {
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
  const notice = n as { id: string; status: string; type: string; snapshot: { method?: string } | null } | null;
  if (!notice || notice.type !== "N12") redirect(anchor(tenancyId, "error"));
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

export async function voidN12(formData: FormData) {
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
    .eq("type", "N12");
  if (error) redirect(anchor(tenancyId, "error"));
  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(anchor(tenancyId, "voided"));
}
