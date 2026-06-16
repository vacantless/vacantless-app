"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { decryptSecret } from "@/lib/crypto";
import {
  normalizeEnvironment,
  validateCustomerInput,
  createCustomer,
  validateScheduleInput,
  createSchedule,
} from "@/lib/rotessa";

// Rotessa customer-creation action for a tenancy (platform pivot step 2,
// increment 2, S211).
//
// Creates a Rotessa CUSTOMER from a tenancy's PRIMARY tenant and stores the
// returned Rotessa customer id on the tenancy. Guarded on manage_rotessa (the
// rent-rail capability — owner_admin + operator), same as the Settings
// connection actions. We send ONLY name/email/phone + custom_identifier (the
// tenancy id); never bank/PAD numbers. REDIRECT-based (the S170 revalidate-503
// WATCH), mirroring rotessa-actions in Settings.

function tenancyPath(id: string): string {
  return `/dashboard/tenancies/${id}`;
}

type PrimaryTenant = { name: string | null; email: string | null; phone: string | null };
type TenancyRow = {
  id: string;
  rotessa_customer_id: string | null;
  tenants: PrimaryTenant[];
};
type RotessaAccountRow = { api_key_encrypted: string | null; environment: string };

export async function createRotessaCustomer(formData: FormData) {
  const tenancyId = String(formData.get("tenancy_id") ?? "").trim();
  if (!tenancyId) redirect("/dashboard/tenancies");

  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rotessa", `${tenancyPath(tenancyId)}?rotessa=forbidden`);

  const supabase = createClient();

  // Load the tenancy + its primary tenant (RLS scopes to this org).
  const { data: tData } = await supabase
    .from("tenancies")
    .select("id, rotessa_customer_id, tenants!inner(name, email, phone, is_primary)")
    .eq("id", tenancyId)
    .eq("tenants.is_primary", true)
    .maybeSingle();

  const tenancy = tData as unknown as TenancyRow | null;
  if (!tenancy) redirect(`${tenancyPath(tenancyId)}?rotessa=noprimary`);

  // Idempotency: never create a second Rotessa customer for the same tenancy.
  if (tenancy.rotessa_customer_id) {
    redirect(`${tenancyPath(tenancyId)}?rotessa=already`);
  }

  const primary = tenancy.tenants?.[0];
  if (!primary) redirect(`${tenancyPath(tenancyId)}?rotessa=noprimary`);

  // The org must have a connected Rotessa account with a stored key.
  const { data: aData } = await supabase
    .from("rotessa_accounts")
    .select("api_key_encrypted, environment")
    .eq("organization_id", org.id)
    .limit(1);
  const account = (aData?.[0] as RotessaAccountRow | undefined) ?? undefined;
  if (!account?.api_key_encrypted) {
    redirect(`${tenancyPath(tenancyId)}?rotessa=notconnected`);
  }

  // Validate what we'll send (Rotessa requires a name).
  const check = validateCustomerInput({
    name: primary.name,
    email: primary.email,
    phone: primary.phone,
    customIdentifier: tenancyId, // stable, unique Vacantless ref
  });
  if (!check.ok) redirect(`${tenancyPath(tenancyId)}?rotessa=noname`);

  let apiKey: string;
  try {
    apiKey = decryptSecret(account.api_key_encrypted);
  } catch {
    redirect(`${tenancyPath(tenancyId)}?rotessa=decfail`);
    return; // unreachable; redirect throws (satisfies the type checker)
  }

  const environment = normalizeEnvironment(account.environment);
  const result = await createCustomer(apiKey, environment, check.value);

  if (!result.ok) {
    redirect(`${tenancyPath(tenancyId)}?rotessa=createfail`);
  }

  await supabase
    .from("tenancies")
    .update({
      rotessa_customer_id: result.customerId,
      rotessa_customer_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenancyId);

  revalidatePath(tenancyPath(tenancyId));
  redirect(`${tenancyPath(tenancyId)}?rotessa=created`);
}

// ===========================================================================
// Increment 3 — create a Monthly rent schedule for a tenancy.
// Requires the tenancy to already have a Rotessa customer (increment 2) and a
// rent amount. Idempotent on rotessa_schedule_id. Bills the customer monthly at
// the tenancy rent starting on the chosen process date.
// ===========================================================================

type ScheduleTenancyRow = {
  id: string;
  rent_cents: number | null;
  rotessa_customer_id: string | null;
  rotessa_schedule_id: string | null;
};

export async function createRotessaSchedule(formData: FormData) {
  const tenancyId = String(formData.get("tenancy_id") ?? "").trim();
  if (!tenancyId) redirect("/dashboard/tenancies");
  const processDateIso = String(formData.get("process_date") ?? "").trim();

  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rotessa", `${tenancyPath(tenancyId)}?rotessa=forbidden`);

  const supabase = createClient();

  const { data: tData } = await supabase
    .from("tenancies")
    .select("id, rent_cents, rotessa_customer_id, rotessa_schedule_id")
    .eq("id", tenancyId)
    .maybeSingle();
  const tenancy = tData as ScheduleTenancyRow | null;
  if (!tenancy) redirect("/dashboard/tenancies");
  if (!tenancy.rotessa_customer_id) redirect(`${tenancyPath(tenancyId)}?rotessa=nocustomer`);
  if (tenancy.rotessa_schedule_id) redirect(`${tenancyPath(tenancyId)}?rotessa=schedalready`);

  // The org's connected Rotessa account.
  const { data: aData } = await supabase
    .from("rotessa_accounts")
    .select("api_key_encrypted, environment")
    .eq("organization_id", org.id)
    .limit(1);
  const account = (aData?.[0] as RotessaAccountRow | undefined) ?? undefined;
  if (!account?.api_key_encrypted) redirect(`${tenancyPath(tenancyId)}?rotessa=notconnected`);

  const todayIso = new Date().toISOString().slice(0, 10);
  const check = validateScheduleInput(
    {
      customerId: tenancy.rotessa_customer_id,
      amountCents: tenancy.rent_cents,
      processDateIso,
    },
    todayIso,
  );
  if (!check.ok) {
    const code = !tenancy.rent_cents ? "norent" : "baddate";
    redirect(`${tenancyPath(tenancyId)}?rotessa=${code}`);
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(account.api_key_encrypted);
  } catch {
    redirect(`${tenancyPath(tenancyId)}?rotessa=decfail`);
    return; // unreachable; redirect throws
  }

  const environment = normalizeEnvironment(account.environment);
  const result = await createSchedule(apiKey, environment, check.value);
  if (!result.ok) redirect(`${tenancyPath(tenancyId)}?rotessa=schedfail`);

  await supabase
    .from("tenancies")
    .update({
      rotessa_schedule_id: result.scheduleId,
      rotessa_schedule_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenancyId);

  revalidatePath(tenancyPath(tenancyId));
  redirect(`${tenancyPath(tenancyId)}?rotessa=scheduled`);
}
