"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { validateBranding } from "@/lib/branding";
import { validateTestRecipient } from "@/lib/test-email";
import { sendTestEmail } from "@/lib/email";
import {
  validateLogoUpload,
  extForLogoType,
  logoStoragePath,
} from "@/lib/logo";

const LOGO_BUCKET = "org-logos";

// Save the owner-editable branding fields (name, brand color, logo URL) onto
// the org row. RLS scopes the update to the caller's own organization.
//
// NOTE: this uses a redirect (not revalidatePath only) on purpose. Revalidate-
// only server actions intermittently 503 at the Vercel edge and the page does
// not refresh even though the write commits (the S170 WATCH). A redirect-based
// action follows the redirect and is unaffected.
export async function updateBranding(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");

  const result = validateBranding({
    name: String(formData.get("name") ?? ""),
    brand_color: String(formData.get("brand_color") ?? ""),
    // The logo is now managed by its own upload action (uploadOrgLogo /
    // removeOrgLogo), not this form — preserve whatever is stored.
    logo_url: org.logo_url ?? "",
    reply_to_email: String(formData.get("reply_to_email") ?? ""),
    feedback_enabled: formData.get("feedback_enabled") != null,
    feedback_delay_hours: String(formData.get("feedback_delay_hours") ?? ""),
    nurture_enabled: formData.get("nurture_enabled") != null,
    sms_enabled: formData.get("sms_enabled") != null,
  });

  if (!result.ok) {
    redirect("/dashboard/settings?error=1");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update(result.values)
    .eq("id", org.id);

  if (error) {
    redirect("/dashboard/settings?error=save");
  }

  redirect("/dashboard/settings?saved=1");
}

// Send the operator a copy of their branded renter auto-reply so they can
// confirm deliverability + branding before going live. Redirect-based (same
// reasoning as updateBranding re: the S170 edge-503 WATCH). The result reason
// drives a precise on-page banner.
export async function sendTestEmailAction(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");

  const recipient = validateTestRecipient(String(formData.get("test_email") ?? ""));
  if (!recipient.ok) {
    redirect("/dashboard/settings?test=invalid");
  }

  const result = await sendTestEmail({
    to_email: recipient.value,
    org_name: org.name,
    brand_color: org.brand_color,
    logo_url: org.logo_url,
    reply_to_email: org.reply_to_email,
  });

  if (!result.sent) {
    // Distinguish "email isn't wired up yet" from a genuine send failure so the
    // operator knows whether it's a config gap or something to retry.
    redirect(
      result.reason === "no_api_key"
        ? "/dashboard/settings?test=nokey"
        : "/dashboard/settings?test=failed",
    );
  }

  redirect(
    `/dashboard/settings?test=sent&to=${encodeURIComponent(recipient.value)}`,
  );
}

// ===========================================================================
// Org logo — upload + remove (Supabase Storage, bucket org-logos, migration
// 0020). The file rides this server action as multipart FormData (the 30mb
// body cap in next.config covers it; a logo is validated at 2 MB). Validation
// is in lib/logo; the storage RLS is the backstop. Redirect-based for the same
// S170 edge-503 reasoning as updateBranding.
// ===========================================================================

// One logo per org: clear the org's folder before writing a fresh file so we
// never leave orphaned objects, and a new filename each time so the public CDN
// URL changes (no stale-cache on replace).
async function clearOrgLogoFolder(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
) {
  const { data: existing } = await supabase.storage
    .from(LOGO_BUCKET)
    .list(orgId);
  if (existing && existing.length > 0) {
    await supabase.storage
      .from(LOGO_BUCKET)
      .remove(existing.map((f) => `${orgId}/${f.name}`));
  }
}

export async function uploadOrgLogo(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");

  const entry = formData.get("logo");
  const file =
    typeof entry === "object" &&
    entry !== null &&
    "size" in entry &&
    "type" in entry
      ? (entry as File)
      : null;

  if (!file || file.size === 0) {
    redirect("/dashboard/settings?logoerr=empty");
  }

  const v = validateLogoUpload({ type: file.type, size: file.size });
  if (!v.ok) {
    redirect(`/dashboard/settings?logoerr=${v.reason}`);
  }

  const supabase = createClient();
  await clearOrgLogoFolder(supabase, org.id);

  const path = logoStoragePath(
    org.id,
    crypto.randomUUID(),
    extForLogoType(file.type),
  );
  const { error: upErr } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) {
    redirect("/dashboard/settings?logoerr=failed");
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);

  const { error: dbErr } = await supabase
    .from("organizations")
    .update({ logo_url: publicUrl })
    .eq("id", org.id);
  if (dbErr) {
    // Roll back the orphaned object so Storage + the row stay in sync.
    await supabase.storage.from(LOGO_BUCKET).remove([path]);
    redirect("/dashboard/settings?logoerr=failed");
  }

  redirect("/dashboard/settings?logo=saved");
}

export async function removeOrgLogo() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");

  const supabase = createClient();
  // Best-effort object cleanup, then null the column (the column is the source
  // of truth for what the public page + emails render).
  await clearOrgLogoFolder(supabase, org.id);
  await supabase
    .from("organizations")
    .update({ logo_url: null })
    .eq("id", org.id);

  redirect("/dashboard/settings?logo=removed");
}
