"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { writeSelectedOrgCookie } from "@/lib/selected-org";

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
