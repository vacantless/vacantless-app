#!/bin/bash
# S842a: a returning renter who already holds a viewing does not book a second
# one by sending the form again; the page names the viewing they have.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'submitted=already&at=' "app/r/[propertyId]/actions.ts" || { echo "STOP: S842a action edit missing"; exit 1; }
grep -q 'You already have a viewing booked' "app/r/[propertyId]/page.tsx" || { echo "STOP: S842a page edit missing"; exit 1; }
grep -q 'heldShowingAt' lib/public-lead-dedup.ts || { echo "STOP: S842a lib edit missing"; exit 1; }
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-public-lead-dedup.ts
npx tsx scripts/test-s748-dates.ts
node scripts/run-all-tests.mjs
git add "app/r/[propertyId]/actions.ts" "app/r/[propertyId]/page.tsx" lib/public-lead-dedup.ts \
  scripts/test-public-lead-dedup.ts scripts/test-s748-dates.ts COMMIT-S842a-NO-SECOND-VIEWING.sh
git --no-pager diff --cached --name-only
git commit -m "S842a: a returning renter with a viewing does not book a second

0334 let returning renters (attached within 60 days, S710) book. The
duplicate guard only covered the 10-minute resend path, so a returning
renter who already held a scheduled viewing could book another by sending
the form again. Now the submit action looks for a future scheduled viewing
on that renter and rental first: no second booking, no auto-reply with a
booking link, and the page says 'You already have a viewing booked' with
the date and how to change it. The team still hears the renter wrote again.
Renters with no viewing still book as in S841h.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGpssfZ8e8bbSQz9ywk"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
