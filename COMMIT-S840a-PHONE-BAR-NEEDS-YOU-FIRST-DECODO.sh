#!/bin/bash
# S840a (REVIEW-S839 step G): "Needs you now" first on Today when it has work,
# a bottom bar on phones (Today, Renters, Viewings, Rentals, More), and the
# health email's Decodo GB line read from traffic stats on Pay As You Go.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
rm -f scripts/test-s830c-proxy-wallet-line.ts.new
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "export const PHONE_BAR" app/dashboard/dashboard-nav.tsx || { echo "STOP: S840a nav edit missing"; exit 1; }
grep -q "{todayItems.length > 0 && todayLane}" app/dashboard/page.tsx || { echo "STOP: S840a Today edit missing"; exit 1; }
grep -q "decodoTraffic30d" app/api/cron/health-digest/route.ts || { echo "STOP: S840a Decodo edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s840-phone-bar.ts
npx tsx scripts/test-s830c-proxy-wallet-line.ts
node scripts/run-all-tests.mjs
git add app/dashboard/dashboard-nav.tsx app/dashboard/layout.tsx app/dashboard/page.tsx \
  app/api/cron/health-digest/route.ts lib/health-digest.ts \
  scripts/test-s840-phone-bar.ts scripts/test-needs-you.ts scripts/test-s830c-proxy-wallet-line.ts \
  COMMIT-S840a-PHONE-BAR-NEEDS-YOU-FIRST-DECODO.sh
git --no-pager diff --cached --name-only
git commit -m "S840a: phone bottom bar, Needs you now first, Decodo GB on Pay As You Go

REVIEW-S839 step G.
- Today: when the Needs you now lane has work (a renter to answer, a viewing
  today) it sits right under the title, above Getting started and the site
  cards. An empty lane keeps its old place below the cards.
- Phones (below lg): a fixed bottom bar with Today, Renters, Viewings,
  Rentals and More (More opens the existing menu). Hidden on the three
  Back / Next step pages and in print; the demo login keeps its own nav.
  The page gets bottom room on phones only.
- Health email: Decodo Pay As You Go has no GB block, so the subscription
  sent no figures. The route now reads 30 days of traffic from
  /api/v2/statistics/traffic and the email says how many GB were used.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMLwSHQkDAVv4gVne"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
