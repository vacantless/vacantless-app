"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { roleCan } from "@/lib/roles";
import { writeSelectedOrgCookie } from "@/lib/selected-org";
import { claimPhoneSetupLink, makeSendKeyFor } from "@/lib/phone-setup-server";
import { PHONE_SETUP_STATE_LINE } from "@/lib/phone-setup";

// S824d: one tap on the phone. Uses the code once, signs this phone in as the
// person who showed it (two-step still asks for its code on the next page,
// lib/supabase/middleware), opens their account, and on iPhone makes the
// Send to Vacantless key so the page can copy it before the Shortcut opens.
export async function setUpThisPhone(
  token: string,
  kind: "iphone" | "android",
): Promise<{ ok: boolean; key?: string; message?: string }> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Something went wrong. Try again in a minute." };
  const claim = await claimPhoneSetupLink(admin, token);
  if (!claim) return { ok: false, message: PHONE_SETUP_STATE_LINE.used };

  const { data: member } = await admin
    .from("memberships")
    .select("role")
    .eq("organization_id", claim.orgId)
    .eq("user_id", claim.userId)
    .maybeSingle();
  const role = (member as { role: string } | null)?.role ?? null;
  if (!role || !roleCan(role, "manage_leads")) {
    return { ok: false, message: "Your sign-in can't add renters in this account." };
  }

  const { data: u } = await admin.auth.admin.getUserById(claim.userId);
  const email = u?.user?.email ?? null;
  if (!email) return { ok: false, message: "Something went wrong. Try again in a minute." };
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (!hashed) return { ok: false, message: "Something went wrong. Try again in a minute." };
  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  if (error) return { ok: false, message: "We could not sign this phone in. Show a new code and try again." };
  writeSelectedOrgCookie(claim.orgId);

  if (kind === "android") return { ok: true };
  const key = await makeSendKeyFor(admin, claim.orgId, claim.userId);
  if (!key) return { ok: false, message: "We could not make a key. Try again." };
  return { ok: true, key };
}
