#!/bin/bash
# S841d (REVIEW-S841-SIGNIN-GROUPING): ask for a site sign-in only when an ad
# is waiting there, check the other sites before the one message, and name a
# site that is due to sign out soon.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
test -f lib/site-work-waiting.ts || { echo "STOP: S841d lib missing"; exit 1; }
grep -q "held_nothing_waiting" app/api/cron/signin-lost/route.ts || { echo "STOP: S841d sweep edit missing"; exit 1; }
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s841d-signin-grouping.ts
npx tsx scripts/test-signin-lost.ts
node scripts/run-all-tests.mjs
git add lib/site-work-waiting.ts lib/site-work-waiting-server.ts lib/signin-lost.ts lib/needs-you.ts \
  lib/site-signin.ts lib/message-catalog.ts app/api/cron/signin-lost/route.ts app/dashboard/page.tsx \
  app/dashboard/site-signin/page.tsx "app/dashboard/site-signin/[channel]/page.tsx" \
  scripts/test-s841d-signin-grouping.ts scripts/test-signin-lost.ts COMMIT-S841d-SIGNIN-ASK-WHEN-WAITING.sh
git --no-pager diff --cached --name-only
git commit -m "S841d: ask for a site sign-in only when an ad is waiting; one ask for every site

Noam, 2026-11-24: signed in to Zumper at 4:12 pm, then Rentals.ca asked at
6:30 pm. The two are checked by different machines at different hours, and
Rentals.ca signs out every 2 to 3 days whether or not anything is waiting.
- Ask only when work waits (lib/site-work-waiting): an open robot job, a
  live ad on a rented or archived rental, or a free Rentals.ca ad at day 17
  of 21. Otherwise no email, text, stamp or Today card; the ads stay up.
  The ask goes out on the first sweep after work appears.
- One check, one ask: when a site is found signed out, the other sites are
  checked again first (up to 30 minutes), then one email and one text name
  every site and open as one sitting.
- A site still signed in but late in a sign-in that usually ends soon
  (Zumper past 70% of about 15 days; Rentals.ca past 2.5 days) is named and
  joins the sitting.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqaQEE8GeiwbwwdKXb"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
