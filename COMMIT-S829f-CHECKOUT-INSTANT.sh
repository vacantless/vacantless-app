#!/bin/bash
# S829f: the ready-to-pay email goes out at once and names the site account.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'checkoutAccountLine' lib/checkout-ready.ts || { echo "STOP: S829f edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s829f-checkout-instant.ts
node scripts/run-all-tests.mjs
git add lib/checkout-ready.ts lib/message-catalog.ts app/api/cron/checkout-ready/route.ts \
  "app/dashboard/properties/[id]/publish-everywhere.tsx" "app/dashboard/properties/[id]/distribute-tab.tsx" \
  "app/dashboard/properties/[id]/page.tsx" supabase/migrations/0320_checkout_ready_instant.sql \
  scripts/test-s829f-checkout-instant.ts COMMIT-S829f-CHECKOUT-INSTANT.sh
git commit -m "S829f: ready-to-pay email goes out at once and names the site account

The first ready-to-pay email arrived 15 minutes after the ad reached
checkout. The database now calls the checkout-ready sweep the moment a run
item turns needs_payment (migration 0320, applied); the 15-minute sweep
stays as the backup. The email and the rental page's pay step also say
which site account to sign in to, since a checkout only shows the ad to
the account that built it.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGorzZRkyX89r57Su5V"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
