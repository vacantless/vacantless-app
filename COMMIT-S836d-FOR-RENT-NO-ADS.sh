#!/bin/bash
# S836d: for rent, no ads up (why the ads came down, and signs it rented).
# Migration 0330 (one new column and a stamp rule, nothing dropped) is already applied.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
test -f lib/ads-down.ts || { echo "STOP: lib/ads-down.ts missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s836d-ads-down.ts
npx tsx scripts/test-s836b-account-report.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/ads-down.ts lib/ads-down-server.ts lib/account-report.ts lib/account-report-server.ts \
  app/dashboard/leasing/page.tsx supabase/migrations/0330_listing_post_down_at.sql \
  scripts/test-s836d-ads-down.ts COMMIT-S836d-FOR-RENT-NO-ADS.sh
git --no-pager diff --cached --name-only
git commit -m "S836d: for rent, no ads up

Noam asked whether we know which listings were up and now are not, and
for a smarter way to tell rented from expired, suspended or terminated.
The ad rows said removed or expired, with no date and no reason, and
nothing put the two questions together.

- Migration 0330: listing_posts.down_at, kept by the database itself (set
  when an ad goes down, cleared when it goes live), so all nine places
  that take ads down are covered. Older ads say the date is not recorded.
- lib/ads-down.ts (pure): for each unit still marked for rent with every
  ad down, why each ad came down (you or Vacantless took it down, the site
  removed it, it expired, not recorded) and the strongest sign it rented
  (a tenancy, an accepted offer, an application, a renter at Applied or
  Leased), counted only since the unit last came on the market.
- One line per unit: Probably rented, mark it rented? / Ads expired,
  repost or mark rented / Ads taken down / reason not recorded. It only
  suggests; marking it rented stays the landlord's click.
- Shown on Leasing (For rent, no ads up) and in the monthly summary.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqyiS529vGUCbVcrNq"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
