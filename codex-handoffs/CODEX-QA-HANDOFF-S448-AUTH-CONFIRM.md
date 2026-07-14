# Codex QA handoff - S448 verifier-free /auth/confirm (token_hash + verifyOtp)

## Problem
Self-serve forgot-password ("reset email keeps looping"). The browser Supabase
client (`@supabase/ssr` `createBrowserClient`) defaults to PKCE, so
`resetPasswordForEmail` emails a `?code` link whose `exchangeCodeForSession`
needs the code_verifier from the requesting browser's localStorage. Opening the
link in the Gmail in-app browser / on another device / after an email scanner
pre-fetch => verifier absent => "This link didn't work" => resend loop. Real
victim: Paul Schwartz (thadmumford2020@gmail.com, org 1a28fea7). S447 only fixed
the operator-provisioned implicit-#hash path in /auth/callback.

## Change (code only, no migration)
- `lib/auth-confirm.ts` (pure): `CONFIRM_OTP_TYPES`, `isAllowedOtpType`,
  `safeNextPath` (same-origin relative guard, mirrors /auth/callback), and
  `planEmailConfirm` returning `{ok, type, token_hash, next}` or `{ok:false}`.
- `app/auth/confirm/route.ts`: GET handler. Reads token_hash/type/next,
  `planEmailConfirm`, `supabase.auth.verifyOtp({type, token_hash})` via the
  server client (cookies), then `redirect(next)`. Any failure (bad params or
  verifyOtp error) -> `redirect("/auth/callback#error=link_invalid")`, which the
  existing /auth/callback client page renders as "This link didn't work - request
  a new link" (its hashError check looks for "error" in the hash).
- `scripts/test-auth-confirm.ts`: 19 tests (type allowlist, open-redirect guard,
  plan happy/sad paths).
- Email templates (dashboard, done by operator post-deploy) repoint to
  `/auth/confirm?token_hash={{ .TokenHash }}&type=...&next=...`.

## Explicitly NOT touched
- `/auth/callback` (PKCE ?code + implicit #hash) - still handles operator
  admin.generateLink provisioned links. Untouched.
- `book_public_showing` and all other RPCs. No SQL/migration.
- `resetPasswordForEmail` in /forgot-password stays; the template switch is what
  routes the emailed link to /auth/confirm. Deploying the route alone is inert
  until templates change (safe additive deploy).

## Gate
tsc --noEmit clean; eslint clean (3 files); test-auth-confirm 19/0.

## Please review for
1. verifyOtp in a Next 14 Route Handler with `@supabase/ssr` server client -
   does the session cookie get set correctly on a `redirect()` response? (We use
   next/navigation `redirect`, matching Supabase's documented /auth/confirm
   example; the server client's setAll writes via next/headers cookies().)
2. Open-redirect: `safeNextPath` rejects `//host` and absolute URLs; is a
   `redirect("/auth/callback#error=...")` fragment preserved cross-browser?
3. Any type that should be excluded from `CONFIRM_OTP_TYPES` for safety
   (e.g. should `email_change` be finalized on this unauthenticated route)?
4. Failure UX: is bouncing to /auth/callback#error acceptable, vs a dedicated
   page? (Chose reuse to avoid a new screen.)
5. Scanner pre-fetch: token_hash GET is still one-time-consumable by a scanner.
   Acceptable tradeoff vs PKCE (which fails cross-browser for everyone)? Any
   reason to prefer a POST-confirm interstitial now?
