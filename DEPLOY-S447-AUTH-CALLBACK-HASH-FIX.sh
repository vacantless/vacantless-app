#!/usr/bin/env bash
# S447 - fix the provisioned set-password / recovery link dead-end (Codex P1).
#
# ROOT CAUSE: app/auth/callback was a SERVER route that only handled the PKCE
# "?code=" flow. But lib/provisioning-server.ts hands landlords a link from
# admin.generateLink({type:"recovery"}), which is generated server-side with no
# client code-verifier — so GoTrue returns the session in the URL *hash*
# ("#access_token=..."), the implicit flow. A server route physically cannot
# read a URL fragment, so it fell through to redirect("/login"), and the browser
# carried the "#access_token" along, dead-ending on /login#access_token=... with
# no way to set a password. (Same reason a forgot-password link opened in a
# different browser failed.)
#
# FIX (view-layer only, NO migration): replace the server route with a CLIENT
# page at the SAME /auth/callback path (so the existing Supabase redirect
# allowlist is unchanged). The client page handles BOTH flows: it explicitly
# exchanges a "?code=" (PKCE) and lets the browser client's detectSessionInUrl
# consume the "#access_token" hash (implicit), then forwards to `next`
# (e.g. /reset-password). Expired/used links show a "request a new link" state
# instead of a blank dead-end. useSearchParams is wrapped in <Suspense> so the
# Vercel production build prerenders cleanly.
#
# Gate: tsc --noEmit clean (verified).
# POST-DEPLOY LIVE TEST (do this once the SHA is READY on Vercel):
#   1. Operator console -> provision a test email you control (or re-send).
#   2. Open the set-password link in a FRESH incognito window.
#   3. Confirm it lands on /reset-password "Choose a new password" (NOT
#      /login#access_token=...), set a password, and you're taken to /dashboard.
#   4. Sanity: forgot-password in the same browser still works end to end.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git rev-parse --is-inside-work-tree >/dev/null

# Remove the old server route (replaced by the client page in the same folder;
# both cannot coexist or `next build` errors with a route/page conflict).
git rm -f 'app/auth/callback/route.ts'

git add \
  'app/auth/callback/page.tsx' \
  DEPLOY-S447-AUTH-CALLBACK-HASH-FIX.sh

git commit -m "S447: fix provisioned recovery/set-password link dead-end - /auth/callback client page handles the implicit hash flow (not just PKCE code), so landlords no longer land on /login#access_token"
git push

echo
echo "Pushed. No migration. Verify the Vercel deploy for this SHA appears (KI677), then run the POST-DEPLOY LIVE TEST above."
git rev-parse --short HEAD
