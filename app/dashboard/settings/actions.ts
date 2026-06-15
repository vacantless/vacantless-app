"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { validateBranding } from "@/lib/branding";

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
