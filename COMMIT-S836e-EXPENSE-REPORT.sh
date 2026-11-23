#!/bin/bash
# S836e: the expense report (after FreshBooks Reports > Expense Report). No migration.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
test -f lib/expense-report.ts || { echo "STOP: lib/expense-report.ts missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s836e-expense-report.ts
npx tsx scripts/test-s836b-account-report.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/expense-report.ts lib/expense-report-server.ts lib/expense-report-params.ts \
  app/dashboard/money/expense-report/page.tsx app/dashboard/money/expense-report/export/route.ts \
  app/dashboard/money/page.tsx lib/account-report.ts lib/account-report-server.ts \
  scripts/test-s836e-expense-report.ts COMMIT-S836e-EXPENSE-REPORT.sh
git --no-pager diff --cached --name-only
git commit -m "S836e: expense report, by category with subtotals

Noam pointed at FreshBooks Reports > Expense Report: every expense,
grouped by category, with the merchant, date and amount, a subtotal per
category and filters. Vacantless had a flat expense list and Spend
analysis (totals only), nothing itemized and grouped.

- Money > Expense report: every expense and repair cost for a date range,
  grouped by category, biggest first, with a total for each, the merchant
  or repair, what it was for and which unit. Filters for dates, unit and
  category; Download CSV with the same lines and subtotal rows.
- The lines are exactly the ones the income statement counts (expenses by
  paid date, repairs with a cost by finish date), so the total equals its
  operating expenses; checked on Davis Muscovitch Rentals (\$2,228.39 this
  year). Mortgage lines are listed last for reference and not counted.
- Every read scoped to the account; books plans only; the CSV also checks
  the view_reports permission.
- The monthly summary links to it under Income and expenses.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqyiS529vGUCbVcrNq"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
