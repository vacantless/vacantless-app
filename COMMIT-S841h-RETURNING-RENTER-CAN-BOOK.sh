#!/bin/bash
# S841h: a returning renter can book a viewing (migration 0334, applied by
# Claude on Noam's "apply 0334"); a refused booking is logged with its reason.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
test -f supabase/migrations/0334_returning_renter_can_book.sql || { echo "STOP: 0334 missing"; exit 1; }
grep -q '\[public-booking\] refused' "app/r/[propertyId]/actions.ts" || { echo "STOP: S841h log edit missing"; exit 1; }
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s841h-returning-renter-books.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0334_returning_renter_can_book.sql "app/r/[propertyId]/actions.ts" \
  scripts/test-s841h-returning-renter-books.ts COMMIT-S841h-RETURNING-RENTER-CAN-BOOK.sh
git --no-pager diff --cached --name-only
git commit -m "S841h: a returning renter can book a viewing

Since S710 a renter who writes again within 60 days is attached to their
existing record, but book_public_showing still required a record under 15
minutes old. Every booking by a returning renter raised 'Booking not
allowed' and the page said 'That time was just taken'. Agile, 21 days: 6
returning renters, 18 tries, 0 bookings; 122 public bookings on file, all
within 11 seconds of the record being made. The 'new viewing times just
opened' text sent exactly these renters to that page.
- 0334: the record also qualifies when submit_public_lead wrote its
  'Wrote again via' note on it in the last 15 minutes. Exact patch of the
  live function; signed-out visitors cannot write messages.
- A refused booking that is not a taken slot is logged with its reason.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqaQEE8GeiwbwwdKXb"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
