"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { writeSelectedOrgCookie } from "@/lib/selected-org";

// Server action for the org switcher (Tier 1 B). Sets the `selected_org` cookie
// so getCurrentOrg() resolves to the chosen client org. The selection is always
// re-validated against the caller's memberships here (defense in depth — RLS on
// memberships already scopes the read to the caller's own rows), so a client can
// never activate an org it does not belong to.
export async function setSelectedOrg(orgId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .limit(1);
  if (!data || data.length === 0) return; // not a member — ignore silently

  writeSelectedOrgCookie(orgId);
  // Re-render every server component so the new org's branding, plan, and
  // policy defaults take effect across the dashboard.
  revalidatePath("/", "layout");
}
