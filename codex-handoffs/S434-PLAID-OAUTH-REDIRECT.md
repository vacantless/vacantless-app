# S434 - Plaid OAuth redirect_uri support (production-readiness for the Plaid flip)

Review range: `e98c3c9..<new HEAD>` (2 files, no migration, no test file change).

## Why

The Plaid adapter already switches its base path on `PLAID_ENV`
(`lib/bank-feed/plaid.ts` `plaidEnv()`), so "flip to production" was believed to be
env-only. But the connect flow passed NO `redirect_uri`, and Canadian production
institutions (RBC, TD, Amex CA) - plus many US banks - use OAuth. OAuth Link
redirects the browser out to the bank and back to a registered `redirect_uri`;
without one, `linkTokenCreate` for those institutions fails and the browser has no
way to resume Link after the hop. So the Manning live-connect test (RBC/TD/Amex)
would have failed at the bank-login handoff. This closes that gap, env-gated so
sandbox stays byte-identical.

## What changed

1. **`lib/bank-feed/plaid.ts`** (server):
   - New `redirectUriFromEnv()` reads `PLAID_REDIRECT_URI` (trimmed; undefined when
     unset).
   - `PlaidProvider.startConnect` spreads `redirect_uri` into `linkTokenCreate`
     ONLY when the env var is set (`...(redirectUri ? { redirect_uri } : {})`).
     Omitting the key entirely (vs. passing `undefined`) keeps the sandbox request
     identical - passing an *unregistered* redirect_uri would itself throw.

2. **`app/dashboard/expenses/PlaidConnectButton.tsx`** (client):
   - Stash the link token in `localStorage` (`vacantless.plaid.link_token`) before
     opening Link, so it survives the OAuth browser redirect.
   - On mount, if the URL carries `?oauth_state_id=` (Plaid's return marker) AND a
     stashed token exists, set `receivedRedirectUri = window.location.href`, restore
     the token, and re-open Link so it resumes.
   - `receivedRedirectUri` is `undefined` on a fresh connect (a fresh `start()`
     resets it) - passing it without an `oauth_state_id` would make Plaid Link
     error.
   - New `onExit` clears the stash on abandon/error; `onSuccess` clears it before
     exchange. `localStorage` access is try/catch-guarded (private mode degrades to
     the non-OAuth flow, which never leaves the page).

## Safety / invariants to check

- **Sandbox byte-identical when `PLAID_REDIRECT_URI` unset:** the server omits the
  key; the client's OAuth-return branch never fires (no `oauth_state_id` in sandbox),
  so the only added client behavior is a stash write+clear that has no effect on the
  in-page flow.
- **No money path, no migration, no schema change.** Connect-flow presentation only.
- **`receivedRedirectUri` never set on the initial leg** (would error).
- **Token reuse on return** is the SAME link token that started the OAuth flow
  (restored from `localStorage`), per Plaid's OAuth resume contract.

## Gates (run in sandbox)

- `tsc --noEmit` clean.
- `eslint lib/bank-feed/plaid.ts app/dashboard/expenses/PlaidConnectButton.tsx` clean.
- `test-bank-feed` 34/0 (seam unchanged - no regression).

## NOT covered here (operator steps, see the runbook)

Registering the redirect URI in the Plaid dashboard, requesting production access,
and setting the Vercel env vars are in
`PLAID-PRODUCTION-FLIP-RUNBOOK-2026-07-07.md`. This commit only makes the code
ready; it ships DARK for production (no behavior change until `PLAID_ENV=production`
+ creds + `PLAID_REDIRECT_URI` are set).
