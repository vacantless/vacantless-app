#!/bin/bash
# S836c: spend advice that fits how the landlord books viewings. No migration.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
test -f lib/channel-costs.ts || { echo "STOP: lib/channel-costs.ts missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s836b-account-report.ts
npx tsx scripts/test-s818c-site-costs.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/channel-costs.ts lib/account-report.ts lib/account-report-server.ts \
  app/api/cron/account-report/route.ts app/dashboard/reports/summary/page.tsx \
  app/dashboard/reports/page.tsx scripts/test-s836b-account-report.ts \
  COMMIT-S836c-HONEST-SPEND-ADVICE.sh
git --no-pager diff --cached --name-only
git commit -m "S836c: spend advice that fits how the landlord books viewings

Read live on Davis Muscovitch Rentals after S836b: the advice said Kijiji
got \"no booked viewings\" and to stop paying. That account books each
viewing itself, so nothing is ever booked in the app, and the two Kijiji
ads were paid the day before.

- An account that books each viewing itself is judged by renters: cost
  per renter, the free site that brought the most renters, and a paid
  site with no renters at all.
- A site first paid under 14 days ago is too early to judge; the line
  says when it was paid and how many renters so far.
- Same rule on Reports (What each site costs you) and in the monthly
  summary. With no options the advice is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqyiS529vGUCbVcrNq"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
