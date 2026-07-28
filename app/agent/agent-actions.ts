"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { writeSelectedOrgCookie } from "@/lib/selected-org";
import { roleCan } from "@/lib/roles";
import {
  buildQuickOnboardFirstTouchDraft,
  quickOnboardDedupeKey,
  quickOnboardSlugBase,
  validateQuickOnboardInput,
  QUICK_ONBOARD_FIRST_TOUCH_EVENT,
  type QuickOnboardInput,
} from "@/lib/quick-onboard";
import { rentConfirmUrl } from "@/lib/rent-confirm-public";
import {
  seedClauseLibrary,
  seedTenantMessageTemplates,
} from "@/lib/org-seeds-server";

type QuickOnboardResult =
  | {
      ok: true;
      orgId: string;
      propertyId: string;
      tenancyId: string;
      confirmUrl: string;
      createdOrg: boolean;
    }
  | {
      ok: false;
      code:
        | "landlord_name"
        | "landlord_email"
        | "property_address"
        | "occupancy_date"
        | "rent"
        | "unauthenticated"
        | "forbidden"
        | "org_create"
        | "org_update"
        | "property_create"
        | "tenancy_create"
        | "confirm_token"
        | "draft_create";
    };

// "Market this unit for [client]" trigger (Tier 1 D). From the cross-org agent
// book, an agent kicks off marketing a specific client's unit: this sets the
// active org to that client (so getCurrentOrg + all org-bound surfaces resolve
// to them), then routes into the EXISTING Get-online wizard with the unit
// pre-staged via ?property=. It reuses the wizard end to end and re-implements
// none of its steps (KI935 hands-off) — in particular it does NOT flip the unit
// to Live; that is the wizard's send-live stage, so the agent still confirms
// each step rather than publishing a client's unit behind their back.
//
// Both the org selection and the property are re-validated server-side against
// the caller's memberships (never trust the client): the cookie can only ever
// activate an org the caller belongs to, and the property must belong to that
// org, so this cannot be used to reach another agent's book.
export async function marketUnitForClient(
  orgId: string,
  propertyId: string,
): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/agent");

  // Caller must be a member of the target org.
  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .limit(1);
  if (!membership || membership.length === 0) redirect("/agent");

  // The unit must belong to that org (RLS already scopes the read to the
  // caller's orgs; the explicit org filter makes the ownership check exact).
  const { data: property } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("organization_id", orgId)
    .limit(1);
  if (!property || property.length === 0) redirect("/agent");

  writeSelectedOrgCookie(orgId);
  redirect(`/dashboard/link-portals?property=${propertyId}`);
}

// Same org-switch guard as marketUnitForClient, but routes to the existing
// tenancy rent-confirm section. This is discovery only: it does not write the
// rent ledger or arm any live send path.
export async function confirmRentForClient(
  orgId: string,
  tenancyId: string,
): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/agent");

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .limit(1);
  if (!membership || membership.length === 0) redirect("/agent");

  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id")
    .eq("id", tenancyId)
    .eq("organization_id", orgId)
    .limit(1);
  if (!tenancy || tenancy.length === 0) redirect("/agent");

  writeSelectedOrgCookie(orgId);
  redirect(`/dashboard/tenancies/${tenancyId}#rent-increase`);
}

export async function quickOnboardLandlordLease(
  input: QuickOnboardInput,
): Promise<QuickOnboardResult> {
  const parsed = validateQuickOnboardInput(input);
  if (!parsed.ok) return { ok: false, code: parsed.code };
  const values = parsed.value;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "unauthenticated" };

  const { data: existingRows } = await supabase
    .from("organizations")
    .select("id, name, pipeda_marketing_consent_at")
    .eq("landlord_campaign_email", values.landlordEmail)
    .limit(1);

  let orgId: string | null =
    ((existingRows ?? [])[0] as { id?: string } | undefined)?.id ?? null;
  let createdOrg = false;

  if (orgId) {
    const { data: membershipRows } = await supabase
      .from("memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .limit(1);
    const role = ((membershipRows ?? [])[0] as { role?: string } | undefined)?.role;
    if (
      !role ||
      !roleCan(role, "manage_properties") ||
      !roleCan(role, "manage_tenancies")
    ) {
      return { ok: false, code: "forbidden" };
    }
  } else {
    const slug = `${quickOnboardSlugBase(
      values.landlordName,
      values.landlordEmail,
    )}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: org, error } = await supabase
      .rpc("create_organization", { p_name: values.landlordName, p_slug: slug })
      .single();
    if (error || !org) return { ok: false, code: "org_create" };
    orgId = (org as { id: string }).id;
    createdOrg = true;

    await seedClauseLibrary(supabase, orgId).catch(() => {});
    await seedTenantMessageTemplates(supabase, orgId).catch(() => {});
  }

  const existingConsentAt =
    ((existingRows ?? [])[0] as
      | { pipeda_marketing_consent_at?: string | null }
      | undefined)?.pipeda_marketing_consent_at ?? null;
  const nowIso = new Date().toISOString();
  const orgPatch: Record<string, unknown> = {
    landlord_campaign_email: values.landlordEmail,
    ...(createdOrg ? { plan: "free" } : {}),
  };
  if (values.marketingConsent && !existingConsentAt) {
    orgPatch.pipeda_marketing_consent_at = nowIso;
    orgPatch.pipeda_marketing_consent_by = user.email ?? user.id;
  }

  const { error: orgUpdateErr } = await supabase
    .from("organizations")
    .update(orgPatch)
    .eq("id", orgId);
  if (orgUpdateErr) return { ok: false, code: "org_update" };

  const { data: property, error: propertyErr } = await supabase
    .from("properties")
    .insert({
      organization_id: orgId,
      status: "leased",
      address: values.propertyAddress,
      rent_cents: values.rentCents,
    })
    .select("id")
    .single();
  const propertyId = (property as { id?: string } | null)?.id ?? null;
  if (propertyErr || !propertyId) return { ok: false, code: "property_create" };

  const { data: tenancy, error: tenancyErr } = await supabase
    .from("tenancies")
    .insert({
      organization_id: orgId,
      property_id: propertyId,
      rent_cents: values.rentCents,
      start_date: values.occupancyDate,
      status: "active",
      last_rent_increase_date: null,
    })
    .select("id, confirm_token")
    .single();
  const tenancyId = (tenancy as { id?: string } | null)?.id ?? null;
  const confirmToken =
    (tenancy as { confirm_token?: string | null } | null)?.confirm_token ?? null;
  if (tenancyErr || !tenancyId) return { ok: false, code: "tenancy_create" };
  if (!confirmToken) return { ok: false, code: "confirm_token" };

  const confirmUrl = rentConfirmUrl(confirmToken);
  const draft = buildQuickOnboardFirstTouchDraft({
    landlordName: values.landlordName,
    propertyAddress: values.propertyAddress,
    rentCents: values.rentCents,
    confirmUrl,
  });
  const { error: draftErr } = await supabase.from("pending_tenant_messages").upsert(
    {
      organization_id: orgId,
      event_key: QUICK_ONBOARD_FIRST_TOUCH_EVENT,
      tenancy_id: tenancyId,
      property_id: propertyId,
      tenant_name: values.landlordName,
      tenant_email: values.landlordEmail,
      subject: draft.subject,
      body: draft.body,
      dedupe_key: quickOnboardDedupeKey(tenancyId),
      status: "pending",
    },
    {
      onConflict: "organization_id,event_key,dedupe_key",
      ignoreDuplicates: true,
    },
  );
  if (draftErr) return { ok: false, code: "draft_create" };

  writeSelectedOrgCookie(orgId);
  revalidatePath("/agent");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/tenancies");
  revalidatePath("/dashboard/messages");

  return {
    ok: true,
    orgId,
    propertyId,
    tenancyId,
    confirmUrl,
    createdOrg,
  };
}

function quickOnboardInputFromForm(formData: FormData): QuickOnboardInput {
  return {
    landlordName: formData.get("landlord_name") as string | null,
    landlordEmail: formData.get("landlord_email") as string | null,
    propertyAddress: formData.get("property_address") as string | null,
    occupancyDate: formData.get("occupancy_date") as string | null,
    rent: formData.get("rent") as string | null,
    marketingConsent: formData.get("marketing_consent") === "on",
  };
}

export async function quickOnboardLandlordLeaseFromForm(formData: FormData) {
  const result = await quickOnboardLandlordLease(quickOnboardInputFromForm(formData));
  if (!result.ok) {
    redirect(`/agent?quick_onboard=error&reason=${result.code}`);
  }
  redirect(
    `/agent?quick_onboard=ok&created_org=${result.createdOrg ? "1" : "0"}&tenancy=${result.tenancyId}`,
  );
}
