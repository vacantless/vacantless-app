#!/bin/bash
# S838a: Marketplace email at day 7, homepage lines and proof numbers, sign-in
# lifetime record (migration 0331 file), reply and viewing times in the reports.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "facebook: 7," lib/distribution-channels.ts || { echo "STOP: S838 day-7 edit missing"; exit 1; }
grep -q "inquiries: 331" lib/proof-stats.ts || { echo "STOP: S838 proof edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s838-response-times.ts
npx tsx scripts/test-s838-signin-lifetime.ts
node scripts/run-all-tests.mjs
git add lib/distribution-channels.ts lib/keep-fresh.ts \
  scripts/test-distribution-channels.ts scripts/test-helper-renew-wait.ts scripts/test-keep-fresh.ts scripts/test-listing-health.ts \
  lib/proof-stats.ts app/page.tsx \
  supabase/migrations/0331_site_signin_events.sql lib/signin-lifetime.ts \
  app/dashboard/admin/signin-lifetime-section.tsx app/dashboard/admin/page.tsx scripts/test-s838-signin-lifetime.ts \
  lib/response-times.ts lib/response-times-server.ts lib/rental-report.ts lib/rental-report-server.ts \
  lib/account-report.ts lib/account-report-server.ts scripts/test-s838-response-times.ts \
  COMMIT-S838a-DAY7-HOMEPAGE-SIGNINS-RESPONSE.sh
git --no-pager diff --cached --name-only
git commit -m "S838a: Marketplace email at day 7, homepage lines, sign-in lifetimes, response times in reports

- Marketplace old-ads email and card now ask at day 7, not 9: Facebook opens
  Renew at day 5 to 7 (KI1793). Wording still says check, never that it is open.
- Homepage: Send to Vacantless in the Showings card, the monthly summary in
  Rent and taxes, proof recounted 2026-11-23 (331 inquiries, 122 viewings,
  nearly 9 in 10 within an hour; 25 robot ads).
- Migration 0331 site_signin_events: a trigger records each robot-site
  sign-in and loss with its time; admin console shows how long they last.
- Monthly rental report and account summary: reply time for renters
  Vacantless answered (Marketplace chats named as not timed, never averaged)
  and time from first inquiry to booking and to the viewing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGpAp81rPXjTsxBS1hM"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
