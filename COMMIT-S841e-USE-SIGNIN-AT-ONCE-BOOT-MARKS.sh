#!/bin/bash
# S841e: a finished site sign-in starts that site's renewals, edits and
# takedowns at once (not only posts); and short-lived boot marks to measure the
# dashboard's cold start.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
test -f lib/boot-mark.ts || { echo "STOP: S841e boot mark missing"; exit 1; }
grep -q "triggerRentalsTakedown() : triggerTakedownNow()" "app/dashboard/site-signin/[channel]/actions.ts" || { echo "STOP: S841e sign-in edit missing"; exit 1; }
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s841d-signin-grouping.ts
npx tsx scripts/test-s841c-keep-warm.ts
node scripts/run-all-tests.mjs
git add lib/boot-mark.ts app/warm/page.tsx app/dashboard/layout.tsx \
  "app/dashboard/site-signin/[channel]/actions.ts" \
  scripts/test-s841d-signin-grouping.ts scripts/test-s841c-keep-warm.ts \
  COMMIT-S841e-USE-SIGNIN-AT-ONCE-BOOT-MARKS.sh
git --no-pager diff --cached --name-only
git commit -m "S841e: use a fresh site sign-in at once; boot marks for the cold start

- A finished sign-in window started only the posting robot. A Rentals.ca
  sign-in lasts 2 to 3 days, and its renewals and takedowns waited for the
  once-a-day home check; Kijiji and Zumper edits and takedowns waited for
  their own sweep. The finished window now also starts the home check
  (Rentals.ca) or the takedown and edit job (Kijiji, Zumper).
- The /warm ping (S841c) did not make the first dashboard load fast: 2.85 s
  after 30 idle minutes. /warm and the dashboard layout each log which
  server copy answered and how long it has been up ([s841-boot]). Logs
  only, removed once read.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqaQEE8GeiwbwwdKXb"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
