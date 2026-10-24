#!/bin/bash
# S736e: "Make my <site> account". Migration 0261 is applied. Run this first,
# then vacantless-worker/COMMIT-S736w-SIGNUP-MODE.sh.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-site-signup.ts
npx tsx scripts/test-site-signin.ts
npx tsx scripts/test-site-signin-chain.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add supabase/migrations/0261_signin_window_signup_mode.sql \
  lib/site-signin.ts "app/dashboard/site-signin/[channel]/actions.ts" "app/dashboard/site-signin/[channel]/page.tsx" \
  scripts/test-site-signup.ts \
  COMMIT-S736e-SIGNUP-BOX.sh COMMIT-S736e-MESSAGE.txt
git commit -F COMMIT-S736e-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
