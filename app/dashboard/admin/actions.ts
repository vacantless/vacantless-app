"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isAdminEmail,
  type ProvisionOutcome,
  type HandoffOutcome,
} from "@/lib/provisioning";
import {
  provisionLandlordOrg,
  handoffProvisionedOrg,
  adminEmails,
} from "@/lib/provisioning-server";
import { isOrgFeatureKey } from "@/lib/feature-entitlements";
import { isPlatformSwitchKey } from "@/lib/platform-switches";
import { cleanOwnNumber } from "@/lib/org-sms-numbers";
import { emailLandlordTextingOn, releaseTwilioNumber } from "@/lib/texting-numbers-server";

// Operator-initiated landlord onboarding (the scale version of WORKFLOW 112).
// Double-gated: the page 404s for non-admins, AND this action rechecks the
// superadmin allowlist server-side before touching the admin API (defense in
// depth — never trust the UI gate alone). Returns the outcome to the client
// form so it can render success + the set-password link, or a friendly error.
export async function onboardLandlordAction(
  input: {
    email: string;
    orgName: string;
    landlordName?: string | null;
    concierge?: boolean;
    intendedOwnerEmail?: string | null;
  },
): Promise<ProvisionOutcome> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdminEmail(user?.email, adminEmails())) {
    return { ok: false, reason: "unknown", detail: "Not authorized." };
  }

  const outcome = await provisionLandlordOrg({
    email: input.email,
    orgName: input.orgName,
    landlordName: input.landlordName ?? null,
    concierge: input.concierge === true,
    intendedOwnerEmail: input.intendedOwnerEmail ?? null,
    source: "operator",
  });

  if (outcome.ok) revalidatePath("/dashboard/admin");
  return outcome;
}

export async function handoffLandlordAction(input: {
  inviteId: string;
  confirmEmail: string;
}): Promise<HandoffOutcome> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdminEmail(user?.email, adminEmails())) {
    return { ok: false, reason: "unknown", detail: "Not authorized." };
  }

  const outcome = await handoffProvisionedOrg(input);
  if (outcome.ok) revalidatePath("/dashboard/admin");
  return outcome;
}

// ---------------------------------------------------------------------------
// Rent-increase guideline (S465). Set the Ontario guideline % for an effective
// year with no redeploy. Double-gated exactly like the onboarding actions: the
// page 404s for non-admins AND this rechecks the superadmin allowlist before the
// service-role write (defense in depth). Writes to rent_guidelines (0135), which
// overrides the code constant ONTARIO_GUIDELINE at runtime.
// ---------------------------------------------------------------------------
export type GuidelineUpsertOutcome =
  | { ok: true; year: number; percent: number }
  | { ok: false; error: string };

export async function upsertRentGuidelineAction(input: {
  year: number;
  percent: number;
}): Promise<GuidelineUpsertOutcome> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email, adminEmails())) {
    return { ok: false, error: "Not authorized." };
  }

  const year = Math.trunc(Number(input.year));
  const percent = Math.round(Number(input.percent) * 100) / 100;
  if (!Number.isInteger(year) || year < 1991 || year > 2100) {
    return { ok: false, error: "Year must be a whole number between 1991 and 2100." };
  }
  if (!Number.isFinite(percent) || percent < 0 || percent > 10) {
    return { ok: false, error: "Guideline % must be between 0 and 10." };
  }

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Service role is not configured." };

  const { error } = await admin.from("rent_guidelines").upsert(
    {
      year,
      percent,
      source: "admin console",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "year" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/admin");
  return { ok: true, year, percent };
}

export async function setOrgFeatureFlagAsAdmin(
  formData: FormData,
): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email, adminEmails())) {
    redirect("/dashboard/admin?features=forbidden");
  }

  const orgId = String(formData.get("organization_id") ?? "").trim();
  const featureKey = String(formData.get("feature_key") ?? "").trim();
  const mode = String(formData.get("mode") ?? "").trim();
  if (!orgId || !isOrgFeatureKey(featureKey) || !["default", "on", "off"].includes(mode)) {
    redirect("/dashboard/admin?features=invalid");
  }

  const admin = createAdminClient();
  if (!admin) {
    redirect("/dashboard/admin?features=not_configured");
  }

  const write =
    mode === "default"
      ? await admin
          .from("organization_feature_flags")
          .delete()
          .eq("organization_id", orgId)
          .eq("feature_key", featureKey)
      : await admin.from("organization_feature_flags").upsert(
          {
            organization_id: orgId,
            feature_key: featureKey,
            enabled: mode === "on",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,feature_key" },
        );

  if (write.error) {
    redirect("/dashboard/admin?features=error");
  }

  revalidatePath("/dashboard/admin");
  redirect("/dashboard/admin?features=saved");
}

// S717: staff-only per-account switches (migration 0247, lib/platform-switches).
export async function setPlatformSwitchAsAdmin(formData: FormData): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email, adminEmails())) {
    redirect("/dashboard/admin?switches=forbidden");
  }
  const orgId = String(formData.get("organization_id") ?? "").trim();
  const key = String(formData.get("switch_key") ?? "").trim();
  const mode = String(formData.get("mode") ?? "").trim();
  if (!orgId || !isPlatformSwitchKey(key) || !["on", "off"].includes(mode)) {
    redirect("/dashboard/admin?switches=invalid");
  }
  const admin = createAdminClient();
  if (!admin) redirect("/dashboard/admin?switches=not_configured");
  const write =
    mode === "off"
      ? await admin.from("platform_org_switches").delete().eq("organization_id", orgId).eq("switch_key", key)
      : await admin.from("platform_org_switches").upsert(
          {
            organization_id: orgId,
            switch_key: key,
            enabled: true,
            updated_at: new Date().toISOString(),
            updated_by: user?.email ?? null,
          },
          { onConflict: "organization_id,switch_key" },
        );
  if (write.error) redirect("/dashboard/admin?switches=error");
  revalidatePath("/dashboard/admin");
  redirect("/dashboard/admin?switches=saved");
}

// S717: staff set a landlord's own texting number (0248). Remove deletes the
// row; save upserts it, on or off.
export async function setOrgSmsNumberAsAdmin(formData: FormData): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email, adminEmails())) {
    redirect("/dashboard/admin?numbers=forbidden");
  }
  const orgId = String(formData.get("organization_id") ?? "").trim();
  const mode = String(formData.get("mode") ?? "").trim();
  if (!orgId || !["save", "remove"].includes(mode)) {
    redirect("/dashboard/admin?numbers=invalid");
  }
  const admin = createAdminClient();
  if (!admin) redirect("/dashboard/admin?numbers=error");
  if (mode === "remove") {
    // S736: a number the app bought is released in Twilio first, so it stops billing.
    const { data: existing } = await admin
      .from("org_sms_numbers")
      .select("twilio_sid")
      .eq("organization_id", orgId)
      .maybeSingle();
    const twilioSid = (existing as { twilio_sid?: string | null } | null)?.twilio_sid ?? null;
    if (twilioSid && !(await releaseTwilioNumber(twilioSid))) redirect("/dashboard/admin?numbers=error");
    const del = await admin.from("org_sms_numbers").delete().eq("organization_id", orgId);
    if (del.error) redirect("/dashboard/admin?numbers=error");
  } else {
    const phone = cleanOwnNumber(String(formData.get("phone") ?? ""));
    if (!phone) redirect("/dashboard/admin?numbers=bad_number");
    const enabled = formData.get("enabled") === "on";
    const { data: before } = await admin
      .from("org_sms_numbers")
      .select("enabled")
      .eq("organization_id", orgId)
      .maybeSingle();
    const write = await admin.from("org_sms_numbers").upsert(
      {
        organization_id: orgId,
        phone_e164: phone,
        provider: "twilio",
        enabled,
        updated_at: new Date().toISOString(),
        updated_by: user?.email ?? null,
      },
      { onConflict: "organization_id" },
    );
    if (write.error) {
      redirect(write.error.code === "23505" ? "/dashboard/admin?numbers=taken" : "/dashboard/admin?numbers=error");
    }
    // S726g: first time a number is switched on, tell the landlord, and clear
    // the waiting request so Admin stops listing them as waiting.
    if (enabled && !(before as { enabled?: boolean } | null)?.enabled) {
      await admin.from("organizations").update({ sms_requested_at: null }).eq("id", orgId);
      await emailLandlordTextingOn(admin, orgId, phone).catch(() => null);
    }
  }
  revalidatePath("/dashboard/admin");
  redirect("/dashboard/admin?numbers=saved");
}

// S736: the "Texting is on" email moved to lib/texting-numbers-server (emailLandlordTextingOn),
// shared with the automatic purchase.
