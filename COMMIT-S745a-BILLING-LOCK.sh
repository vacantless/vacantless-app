#!/bin/bash
# S745a: billing columns locked. App first; migration 0266 is applied by Claude after Vercel is READY.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-billing-columns-locked.ts
npx tsx scripts/test-posting-addon.ts
npx tsx scripts/test-billing-honesty.ts
npx tsx scripts/test-feature-entitlements-generalized.ts
echo "== commit"
git add app/dashboard/billing/actions.ts app/dashboard/settings/actions.ts \
  supabase/migrations/0266_lock_billing_columns.sql \
  scripts/test-billing-columns-locked.ts \
  COMMIT-S745a-BILLING-LOCK.sh COMMIT-S745a-MESSAGE.txt
git commit -F COMMIT-S745a-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
