import type { SupabaseClient } from "@supabase/supabase-js";
import { hashSendKey, makeSendKey, sendKeyHint } from "@/lib/send-shortcut";
import { isPhoneSetupToken } from "@/lib/phone-setup";

// S824d: the server half of "Set up my phone" (lib/phone-setup.ts). Service
// role only; callers check the person and their role first.

/** One key per person per account: older keys stop working. */
export async function makeSendKeyFor(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<string | null> {
  const now = new Date().toISOString();
  await admin
    .from("capture_keys")
    .update({ revoked_at: now })
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .is("revoked_at", null);
  const key = makeSendKey();
  const { error } = await admin.from("capture_keys").insert({
    organization_id: orgId,
    user_id: userId,
    key_hash: hashSendKey(key),
    key_hint: sendKeyHint(key),
  });
  return error ? null : key;
}

export async function createPhoneSetupLink(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("phone_setup_links")
    .insert({ organization_id: orgId, user_id: userId })
    .select("token")
    .maybeSingle();
  if (error || !data) return null;
  return (data as { token: string }).token;
}

export async function readPhoneSetupLink(
  admin: SupabaseClient,
  token: string,
): Promise<{ expires_at: string; used_at: string | null } | null> {
  if (!isPhoneSetupToken(token)) return null;
  const { data } = await admin
    .from("phone_setup_links")
    .select("expires_at, used_at")
    .eq("token", token.toLowerCase())
    .maybeSingle();
  return (data as { expires_at: string; used_at: string | null } | null) ?? null;
}

/** Use the link once: only one tap ever gets the person and account back. */
export async function claimPhoneSetupLink(
  admin: SupabaseClient,
  token: string,
): Promise<{ orgId: string; userId: string } | null> {
  if (!isPhoneSetupToken(token)) return null;
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("phone_setup_links")
    .update({ used_at: now })
    .eq("token", token.toLowerCase())
    .is("used_at", null)
    .gt("expires_at", now)
    .select("organization_id, user_id")
    .maybeSingle();
  if (error || !data) return null;
  const r = data as { organization_id: string; user_id: string };
  return { orgId: r.organization_id, userId: r.user_id };
}
