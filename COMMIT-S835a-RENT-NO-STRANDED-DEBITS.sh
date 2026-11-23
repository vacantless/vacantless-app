#!/bin/bash
# S835a: REVIEW-S835 findings 1 and 2. Disconnect is refused while rent is
# collecting, and one tenancy can never get two rent subscriptions.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "S835a" lib/stripe-connect.ts || { echo "STOP: S835a edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-stripe-rent-stop.ts
node scripts/run-all-tests.mjs
git add lib/stripe-connect.ts app/dashboard/tenancies/stripe-rent-actions.ts \
  "app/dashboard/tenancies/[id]/page.tsx" app/dashboard/settings/stripe-connect-actions.ts \
  app/dashboard/settings/rotessa-actions.ts app/dashboard/settings/page.tsx \
  scripts/test-stripe-rent-stop.ts COMMIT-S835a-RENT-NO-STRANDED-DEBITS.sh
git --no-pager diff --cached --name-only
git commit -m "S835a: no stranded rent debits (REVIEW-S835 findings 1 and 2)

Finding 1: Disconnect on Settings deleted the Stripe or Rotessa link in
one tap even while tenants were being debited. The debits kept running
and nothing in Vacantless could stop them. Disconnect is now refused
while any tenant's monthly rent is live (Stripe subscription or Rotessa
schedule), and Settings says how many and what to do first.

Finding 2: creating the rent subscription had no guard against a second
one. It now passes an idempotency key (tenancy, amount, first charge
date, previous subscription), looks at Stripe for a live Vacantless
subscription first and shows that one instead of creating another, and
stamps the tenancy id on the subscription. A save that fails after
Stripe said yes is reported, and pressing the button again finds the
subscription Stripe already has.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqgtQ1cMJNk8rr2K6R"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
