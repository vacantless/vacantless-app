#!/bin/bash
# S818c: what each rental site costs you (Reports), and no credit line on accounts that use their own form.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s818c-site-costs.ts
npx tsx scripts/test-s748-dates.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/channel-costs.ts app/dashboard/reports/actions.ts app/dashboard/reports/page.tsx \
  "app/dashboard/leads/[id]/application-card.tsx" app/page.tsx \
  supabase/migrations/0310_marketing_costs.sql scripts/test-s818c-site-costs.ts COMMIT-S818c-SITE-COSTS.sh
git commit -m "S818c: what each rental site costs you, on Reports

A landlord could see which site brought renters but not what each one cost,
so there was no way to tell whether a Kijiji ad or a Facebook boost was worth
it. Reports now takes what you paid each site (0310 marketing_costs, already
applied) and shows renters, booked, showed, leased, paid, cost per renter and
per booked viewing, with plain lines: a paid site with no viewings, the best
free site, the cheapest paid viewing. Page-link renters are not charged to
any site. Accounts that use their own application form no longer see the
credit check line on the renter page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGokzebAsp6GCX7VNvL"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
