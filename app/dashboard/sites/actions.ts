"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { cleanPropertyId } from "@/lib/site-signin";
import { sendNotificationEmail } from "@/lib/email";
import { sitesComputerEmail, sitesComputerPath } from "@/lib/sites-phone";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

// S768 (REVIEW-S761 section 5 item 1): on a phone, email the signed-in person
// the link to "Connect your rental sites" so they finish on a computer. Goes
// only to the person pressing the button. The rental is kept only when it
// belongs to the signed-in account.
export async function emailSitesComputerLink(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();

  let propertyId: string | null = null;
  let address: string | null = null;
  const wanted = cleanPropertyId(String(formData.get("property_id") ?? ""));
  if (wanted) {
    const { data: owned } = await supabase
      .from("properties")
      .select("id, address")
      .eq("id", wanted)
      .eq("organization_id", org.id)
      .maybeSingle();
    if (owned?.id) {
      propertyId = owned.id as string;
      address = (owned.address as string | null) ?? null;
    }
  }
  const back = (mailed: "1" | "0") => {
    const base = sitesComputerPath(propertyId);
    return `${base}${base.includes("?") ? "&" : "?"}mailed=${mailed}`;
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const to = user?.email?.trim();
  if (!to) redirect(back("0"));

  const mail = sitesComputerEmail({ address });
  const result = await sendNotificationEmail({
    to_email: to,
    subject: mail.subject,
    body: mail.body,
    action_label: "Connect my rental sites",
    action_url: `${APP_URL}${sitesComputerPath(propertyId)}`,
    org_name: org.name ?? "Vacantless",
    brand_color: org.brand_color ?? null,
    logo_url: org.logo_url ?? null,
    reply_to_email: null,
  }).catch(() => ({ sent: false }));
  if (!result.sent) console.warn(`[sites-phone] org ${org.id}: email not sent`);
  redirect(back(result.sent ? "1" : "0"));
}

// S770 (REVIEW-S770 section 3 item 3): "I don't have a Facebook Page". The
// row leaves the sites list and the count, for this account only. "Add it
// back" clears the stamp. A linked Page always wins (lib/sites-setup).
export async function setFacebookPageSkipped(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const skip = String(formData.get("skip") ?? "") === "1";
  await supabase
    .from("organizations")
    .update({ facebook_page_skipped_at: skip ? new Date().toISOString() : null })
    .eq("id", org.id);
  const propertyId = cleanPropertyId(String(formData.get("property_id") ?? ""));
  redirect(sitesComputerPath(propertyId));
}
