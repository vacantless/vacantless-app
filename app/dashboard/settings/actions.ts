"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { validateBranding } from "@/lib/branding";
import { validateTestRecipient } from "@/lib/test-email";
import { sendTestEmail } from "@/lib/email";

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
    logo_url: String(formData.get("logo_url") ?? ""),
    reply_to_email: String(formData.get("reply_to_email") ?? ""),
    feedback_enabled: formData.get("feedback_enabled") != null,
    feedback_delay_hours: String(formData.get("feedback_delay_hours") ?? ""),
    nurture_enabled: formData.get("nurture_enabled") != null,
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
