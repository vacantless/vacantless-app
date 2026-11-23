#!/bin/bash
# S835f: REVIEW-S835 finding 8 (the rent app line) and the unchecked bank
# authorization. No migration.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "S835f" lib/vendor-costs.ts || { echo "STOP: S835f edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s835e-rail-lock-webhook-saves.ts
npx tsx scripts/test-s832-vendor-costs.ts
node scripts/run-all-tests.mjs
git add lib/vendor-costs.ts app/dashboard/tenancies/stripe-rent-actions.ts \
  "app/dashboard/tenancies/[id]/page.tsx" scripts/test-s835e-rail-lock-webhook-saves.ts \
  COMMIT-S835f-RENT-APP-LINE-MANDATE-CHECK.sh
git --no-pager diff --cached --name-only
git commit -m "S835f: rent app line names Pro only; no rent on an unchecked authorization

Finding 8 (Noam's wording): the pays-for-itself line reads US\$12 a
month for 3 units, vendor Landlord Studio Pro, US plan, billed yearly.
It names Pro only; their free Go plan is a different plan.

If Stripe can not be reached to check that a bank authorization covers
monthly rent, rent is no longer scheduled anyway. The page says to try
again. An unchecked authorization is how the first \$5 test failed.

Migration 0327 (S835e) is applied: the Stripe and Rotessa link tables
refuse writes from a signed-in browser. Proven live: Refresh status on
Settings still saves.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqgtQ1cMJNk8rr2K6R"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
