#!/bin/bash
# S746b: referral credit. Migration 0267 is applied through the Supabase MCP
# before this runs (Claude calls apply_migration, Noam approves the prompt).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-referral-credit.ts
npx tsx scripts/test-referrals.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add lib/referral-credit.ts lib/referral-credit-server.ts \
  app/api/stripe/webhook/route.ts app/dashboard/referrals/page.tsx \
  supabase/migrations/0267_referral_credit.sql \
  scripts/test-referral-credit.ts \
  COMMIT-S746b-REFERRAL-CREDIT.sh COMMIT-S746b-MESSAGE.txt
git commit -F COMMIT-S746b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
