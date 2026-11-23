#!/bin/bash
# S835b: REVIEW-S835 findings 3 to 6 on the rent path.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "S835b" lib/stripe-connect.ts || { echo "STOP: S835b edit missing"; exit 1; }
test -f lib/rent-failed-notify.ts || { echo "STOP: lib/rent-failed-notify.ts missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-stripe-rent-stop.ts
npx tsx scripts/test-stripe-webhook.ts
npx tsx scripts/test-s824e-message-catalog.ts
node scripts/run-all-tests.mjs
git add lib/stripe-connect.ts lib/rent-failed.ts lib/rent-failed-notify.ts lib/message-catalog.ts \
  lib/dashboard-today.ts app/dashboard/page.tsx app/dashboard/tenancies/actions.ts \
  app/dashboard/tenancies/stripe-rent-actions.ts "app/dashboard/tenancies/[id]/page.tsx" \
  app/api/stripe/webhook/route.ts app/rent-authorized/page.tsx \
  components/tenancy-stripe-rent-section.tsx components/copy-link-button.tsx \
  scripts/test-stripe-rent-stop.ts scripts/test-stripe-webhook.ts COMMIT-S835b-RENT-REVIEW-3-TO-6.sh
git --no-pager diff --cached --name-only
git commit -m "S835b: rent path fixes from REVIEW-S835 (findings 3 to 6)

3. The Status box on the lease form can no longer set a tenancy to Ended
   while rent is collecting. It says to use End tenancy, which stops the
   rent too.
4. The tenant's bank link is kept while it still works instead of being
   replaced on every press, and is shown on the tenancy with a Copy
   button and when it runs out. The landlord is no longer sent into the
   tenant's Stripe page. If the tenant finishes on an earlier link, the
   webhook finds the tenancy by its Stripe customer.
5. A failed rent debit emails the account owners (new row on Every
   message we send) and shows on Today until it is paid.
6. The rent card shows the amount Stripe bills, and says so when it
   differs from the rent saved on the page.

Also: the tenant's not-completed page loses its em dash.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqgtQ1cMJNk8rr2K6R"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
