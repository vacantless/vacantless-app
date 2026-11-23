"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { validateNsfCharge } from "@/lib/nsf-charge";

// S835c: NSF charges on a tenancy. A record of what the bank charged the
// landlord for a failed rent payment, plus an optional admin charge ($20 at
// most, checked here and by the table). Nothing here touches Stripe, Rotessa
// or the tenant's bank. Guarded on manage_rent; RLS scopes every row.

function back(tenancyId: string, code: string): string {
  return `/dashboard/tenancies/${tenancyId}?nsf=${code}#nsf-charges`;
}

async function guard(tenancyId: string) {
  if (!tenancyId) redirect("/dashboard/tenancies");
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rent", back(tenancyId, "forbidden"));
  return org;
}

export async function addNsfCharge(formData: FormData) {
  const tenancyId = String(formData.get("tenancy_id") ?? "").trim();
  const org = await guard(tenancyId);
  const check = validateNsfCharge({
    incurredOn: String(formData.get("incurred_on") ?? ""),
    bankCharge: String(formData.get("bank_charge") ?? ""),
    adminCharge: String(formData.get("admin_charge") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!check.ok) redirect(back(tenancyId, check.code));
  const supabase = createClient();
  // The tenancy must be this account's (RLS scopes the read).
  const { data: t } = await supabase.from("tenancies").select("id").eq("id", tenancyId).eq("organization_id", org.id).maybeSingle();
  if (!t) redirect("/dashboard/tenancies");
  const { error } = await supabase.from("tenancy_nsf_charges").insert({
    organization_id: org.id,
    tenancy_id: tenancyId,
    incurred_on: check.value.incurredOn,
    bank_charge_cents: check.value.bankChargeCents,
    admin_charge_cents: check.value.adminChargeCents,
    note: check.value.note,
    source: "manual",
  });
  if (error) redirect(back(tenancyId, "fail"));
  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(back(tenancyId, "added"));
}

export async function updateNsfCharge(formData: FormData) {
  const tenancyId = String(formData.get("tenancy_id") ?? "").trim();
  const id = String(formData.get("id") ?? "").trim();
  const org = await guard(tenancyId);
  if (!id) redirect(back(tenancyId, "fail"));
  const check = validateNsfCharge({
    incurredOn: String(formData.get("incurred_on") ?? ""),
    bankCharge: String(formData.get("bank_charge") ?? ""),
    adminCharge: String(formData.get("admin_charge") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!check.ok) redirect(back(tenancyId, check.code));
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tenancy_nsf_charges")
    .update({
      incurred_on: check.value.incurredOn,
      bank_charge_cents: check.value.bankChargeCents,
      admin_charge_cents: check.value.adminChargeCents,
      note: check.value.note,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenancy_id", tenancyId)
    .eq("organization_id", org.id)
    .select("id");
  if (error || !data || data.length === 0) redirect(back(tenancyId, "fail"));
  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(back(tenancyId, "saved"));
}

export async function setNsfChargePaid(formData: FormData) {
  const tenancyId = String(formData.get("tenancy_id") ?? "").trim();
  const id = String(formData.get("id") ?? "").trim();
  const org = await guard(tenancyId);
  const paid = String(formData.get("paid") ?? "") === "yes";
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tenancy_nsf_charges")
    .update({ paid_at: paid ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenancy_id", tenancyId)
    .eq("organization_id", org.id)
    .select("id");
  if (error || !data || data.length === 0) redirect(back(tenancyId, "fail"));
  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(back(tenancyId, paid ? "paid" : "unpaid"));
}

export async function removeNsfCharge(formData: FormData) {
  const tenancyId = String(formData.get("tenancy_id") ?? "").trim();
  const id = String(formData.get("id") ?? "").trim();
  const org = await guard(tenancyId);
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tenancy_nsf_charges")
    .delete()
    .eq("id", id)
    .eq("tenancy_id", tenancyId)
    .eq("organization_id", org.id)
    .select("id");
  if (error || !data || data.length === 0) redirect(back(tenancyId, "fail"));
  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(back(tenancyId, "removed"));
}
