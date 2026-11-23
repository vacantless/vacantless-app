#!/bin/bash
# S836b: the monthly account summary (email on the 1st and Reports page).
# Migration 0329 (one new column, nothing dropped) is already applied.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
test -f lib/account-report.ts || { echo "STOP: lib/account-report.ts missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s836b-account-report.ts
npx tsx scripts/test-s831-rental-report.ts
npx tsx scripts/test-s824e-message-catalog.ts
npx tsx scripts/test-sweep-timer.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/account-report.ts lib/account-report-server.ts \
  app/api/cron/account-report/route.ts app/dashboard/reports/summary/page.tsx \
  app/dashboard/reports/page.tsx lib/cron-sweeps.ts lib/message-catalog.ts \
  .github/workflows/reminders.yml supabase/migrations/0329_account_report.sql \
  scripts/test-s836b-account-report.ts COMMIT-S836b-ACCOUNT-SUMMARY.sh
git --no-pager diff --cached --name-only
git commit -m "S836b: a monthly summary for the whole account

Noam asked for the questions an owner asks each month: vacancy rate,
units rented or on the market and for how long, inquiries and showings
for each unit, income vs expenses, what each site cost and whether to
spend differently. The per-rental reports answered only one unit.

- lib/account-report.ts (pure): four tiles (vacancy rate, rented, on
  the market, net), each unit with days, inquiries and showings, income
  and expenses for the month and the year, each site's renters and cost
  per renter, and the existing cost advice. Off-market units are left
  out of the rate and named. No books, or none kept here, says so
  instead of showing \$0.
- Income and expenses come from the income statement model and rows,
  with the biggest expense categories (the rest as Other costs), a
  margin line and a loss in red, after the FreshBooks Profit and Loss.
  Site ad costs not already entered as an advertising expense (same
  amount, same day) show on their own line.
- Emailed on the 1st from 9 am under the same Monthly report switch and
  Also send to list. Claimed before sending; handed back and retried if
  nobody got it; the sweep says so. Also on the GitHub backup timer.
- Reports links to Monthly summary: last month or this month so far,
  the same page as the email.
- Migration 0329: organizations.account_report_sent_month.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqyiS529vGUCbVcrNq"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
