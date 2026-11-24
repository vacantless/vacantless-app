#!/bin/bash
# S839b: the S839a loading screen only showed when the top section changed.
# A link inside a section (Rentals list to one rental) still showed nothing
# for about 3 seconds [seen live 2026-11-23]. Each section now has its own.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
test -f app/dashboard/properties/loading.tsx || { echo "STOP: S839b loading files missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s839-photo-size.ts
node scripts/run-all-tests.mjs
git add "app/dashboard/admin/loading.tsx" "app/dashboard/automations/loading.tsx" "app/dashboard/leads/loading.tsx" "app/dashboard/leasing/loading.tsx" "app/dashboard/maintenance/loading.tsx" "app/dashboard/money/loading.tsx" "app/dashboard/people/loading.tsx" "app/dashboard/properties/loading.tsx" "app/dashboard/rent/loading.tsx" "app/dashboard/reports/loading.tsx" "app/dashboard/settings/loading.tsx" "app/dashboard/site-signin/loading.tsx" "app/dashboard/tenancies/[id]/lease/[leaseId]/loading.tsx" "app/dashboard/tenancies/[id]/lease/loading.tsx" "app/dashboard/tenancies/[id]/loading.tsx" "app/dashboard/tenancies/loading.tsx" "app/dashboard/tenants/loading.tsx"  scripts/test-s839-photo-size.ts COMMIT-S839b-LOADING-INSIDE-SECTIONS.sh
git --no-pager diff --cached --name-only
git commit -m "S839b: loading screen for links inside a section

S839a put one loading screen at the top of the dashboard. It shows when the
top section changes (Today to Rentals) but not for a link inside a section
(Rentals list to one rental, a tenancy to its lease): the old page stayed
for about 3 seconds. Each section with pages under it now re-exports the
same loading screen, 17 files.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrF59iM2qiBS4Uh8MK"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
