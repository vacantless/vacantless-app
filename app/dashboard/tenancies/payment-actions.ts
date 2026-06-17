"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  parseAmountToCents,
  parseDateOrNull,
  normalizePeriodMonth,
  validatePaymentInput,
} from "@/lib/payments";

// Manual rent-payment bookkeeping actions for a tenancy (platform pivot step 2,
// the manual-payment-tracking complement, S212).
//
// These record money the landlord RECEIVED by e-transfer / cheque / cash — we
// never move money. Guarded on manage_tenancies (the post-lease property-
// management capability — owner_admin + operator), same as the rest of the
// tenancy CRUD. REDIRECT-based (the S170 revalidate-503 WATCH). RLS WITH CHECK
// enforces organization_id; the tenancy FK is the backstop.

const FORBIDDEN_BASE = "/dashboard/tenancies";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function tenancyPath(id: string): string {
  return `/dashboard/tenancies/${id}`;
}

export async function recordPayment(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect(FORBIDDEN_BASE);
  await requireCapability("manage_tenancies", `${tenancyPath(tenancyId)}?paid=forbidden`);

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const amountCents = parseAmountToCents(s(formData, "amount"));
  const method = s(formData, "method");
  const paidOn = parseDateOrNull(s(formData, "paid_on"));

  const check = validatePaymentInput({ amountCents, method, paidOn });
  if (!check.ok) redirect(`${tenancyPath(tenancyId)}?paid=${check.code}`);

  // Optional fields. period_month normalizes to the first of the month (the
  // reconcile key); a blank month means an unassigned (lump-sum/misc) payment.
  const periodMonth = normalizePeriodMonth(s(formData, "period_month"));
  const reference = s(formData, "reference") || null;
  const note = s(formData, "note") || null;

  const supabase = createClient();
  // Confirm the tenancy belongs to this org before writing the child row (RLS
  // also gates the insert, but this gives a clean "not found" rather than a
  // silent FK/RLS rejection).
  const { data: tRow } = await supabase
    .from("tenancies")
    .select("id")
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tRow) redirect(FORBIDDEN_BASE);

  await supabase.from("rent_payments").insert({
    organization_id: org.id,
    tenancy_id: tenancyId,
    amount_cents: check.value.amountCents,
    method: check.value.method,
    paid_on: check.value.paidOn,
    period_month: periodMonth,
    reference,
    note,
  });

  revalidatePath(tenancyPath(tenancyId));
  redirect(`${tenancyPath(tenancyId)}?paid=recorded`);
}

export async function deletePayment(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "payment_id");
  if (!tenancyId || !id) redirect(FORBIDDEN_BASE);
  await requireCapability("manage_tenancies", `${tenancyPath(tenancyId)}?paid=forbidden`);

  const supabase = createClient();
  // RLS scopes the delete to the caller's org; .eq("id") targets one row.
  await supabase.from("rent_payments").delete().eq("id", id).eq("tenancy_id", tenancyId);

  revalidatePath(tenancyPath(tenancyId));
  redirect(`${tenancyPath(tenancyId)}?paid=deleted`);
}
