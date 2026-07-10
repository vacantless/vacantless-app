// Pure helpers for the verifier-free email-confirmation route (/auth/confirm).
//
// Supabase's browser client defaults to the PKCE flow, so a link built from the
// email's ?code can only be finished in the SAME browser that requested it (the
// code_verifier lives in that browser's localStorage). That silently breaks when
// a landlord opens the link in the Gmail in-app browser, on a second device, or
// when an email security scanner pre-fetches it - the classic "reset email keeps
// looping" bug. The token_hash + verifyOtp flow validates the hashed OTP
// server-side instead, so a recovery / signup / invite link works from ANY
// browser or device. These helpers are pure (no IO) so they are unit-testable;
// the impure verifyOtp call lives in app/auth/confirm/route.ts.
import { type EmailOtpType } from "@supabase/supabase-js";

// The OTP types our email templates may point at /auth/confirm.
export const CONFIRM_OTP_TYPES: readonly EmailOtpType[] = [
  "recovery",
  "signup",
  "invite",
  "email",
  "email_change",
  "magiclink",
];

export function isAllowedOtpType(
  t: string | null | undefined,
): t is EmailOtpType {
  return !!t && (CONFIRM_OTP_TYPES as readonly string[]).includes(t);
}

// Only allow an internal, same-origin relative path (guard against an open
// redirect via a crafted ?next=//evil.com or ?next=https://evil.com). Mirrors
// the guard in /auth/callback.
export function safeNextPath(
  raw: string | null | undefined,
  fallback = "/dashboard",
): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

export type ConfirmParams = {
  token_hash: string | null | undefined;
  type: string | null | undefined;
  next: string | null | undefined;
};

export type ConfirmPlan =
  | { ok: true; type: EmailOtpType; token_hash: string; next: string }
  | { ok: false };

// Validate the query params of an incoming email-confirmation link. Returns the
// normalized verifyOtp inputs + a safe redirect target, or ok:false when the
// link is malformed (missing token_hash / unknown type) so the route can bounce
// to the "this link didn't work" screen without calling Supabase.
export function planEmailConfirm(p: ConfirmParams): ConfirmPlan {
  if (!p.token_hash) return { ok: false };
  if (!isAllowedOtpType(p.type)) return { ok: false };
  return {
    ok: true,
    type: p.type,
    token_hash: p.token_hash,
    next: safeNextPath(p.next),
  };
}
