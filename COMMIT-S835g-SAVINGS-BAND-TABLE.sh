#!/bin/bash
# S835g: the price comparison near the top of the homepage, and the cost table
# restyled. No migration.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
test -f components/savings-band.tsx || { echo "STOP: components/savings-band.tsx missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s832-vendor-costs.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add components/savings-band.tsx components/vendor-cost-table.tsx app/page.tsx \
  scripts/test-s832-vendor-costs.ts COMMIT-S835g-SAVINGS-BAND-TABLE.sh
git --no-pager diff --cached --name-only
git commit -m "S835g: what it replaces, near the top; the cost table restyled

Noam: should the cost table come earlier, and look better. Its one
strong line (the monthly apps together, beside Starter) sat 70% down
the homepage in a small grey bar.

- A new band right after What you stop doing: the monthly apps added up
  (typical list prices) beside Vacantless Starter, the property manager
  line beside it and never inside the total, and a link down to the
  full list.
- The table: the comparison first and large, plain rows of job and
  price, and every source in one list that opens. On the homepage the
  rows are folded; on Billing they stay open.
The rules are unchanged: typical prices, never you will save, only the
monthly apps are added up, per-job prices are not.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqgtQ1cMJNk8rr2K6R"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
