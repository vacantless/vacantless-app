#!/bin/bash
# S837a: REVIEW-S835 finding 11 leftovers. No migration.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
rm -f scripts/test-s837a-tenancy-save.ts.tmp
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
test -f scripts/test-s837a-tenancy-save.ts || { echo "STOP: test file missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s837a-tenancy-save.ts
npx tsx scripts/test-s834a-rent-path.ts
npx tsx scripts/test-stripe-rent-update.ts
node scripts/run-all-tests.mjs
git add app/dashboard/tenancies/actions.ts lib/tenancy.ts \
  app/dashboard/tenancies/stripe-rent-actions.ts lib/stripe-connect.ts \
  scripts/test-s837a-tenancy-save.ts COMMIT-S837a-TENANCY-SAVE-RENT-SCHEDULE.sh
git --no-pager diff --cached --name-only
git commit -m "S837a: no orphan rental on a failed tenancy save; second-year rent increase

REVIEW-S835 finding 11 leftovers.

- New tenancy with a typed address: the rental made on the form is
  deleted again if any later check or the tenancy save fails, so a failed
  save leaves nothing behind and a retry does not make a second rental.
  A failed tenancy save now says so on the form instead of dropping the
  landlord on the Tenants list.
- The tenant rows insert is checked; if it fails the tenancy page says
  the tenancy saved but the tenant did not, and to add the tenant there.
- Stripe rent increase: the second phase lasts one cycle, then Stripe
  releases the schedule. A saved schedule that is no longer running
  (released, completed, canceled) is now replaced by a fresh one from the
  subscription, so next year's increase does not fail.
- Sign-up plan on email confirmation: checked, not changed. Email
  confirmation is off (every email sign-up in 30 days confirmed at once),
  so the plan carries through.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGq62AeiRudKPY5nbjt"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
