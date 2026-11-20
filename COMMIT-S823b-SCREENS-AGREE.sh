#!/bin/bash
# S823b: Agile's screens stop contradicting each other (REVIEW-S823 section 3).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-demand-check.ts
npx tsx scripts/test-unit-journey.ts
npx tsx scripts/test-unit-progress.ts
npx tsx scripts/test-reports.ts
npx tsx scripts/test-lead-triage.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/demand-check.ts lib/unit-journey.ts lib/unit-progress.ts lib/reports.ts lib/lead-triage.ts app/dashboard/page.tsx "app/dashboard/properties/[id]/page.tsx" app/dashboard/properties/page.tsx app/dashboard/reports/page.tsx app/dashboard/leads/triage-queue.tsx scripts/test-demand-check.ts scripts/test-unit-journey.ts scripts/test-unit-progress.ts scripts/test-reports.ts scripts/test-lead-triage.ts COMMIT-S823b-SCREENS-AGREE.sh
git commit -m "S823b: the screens agree with each other

Four places on Agile's account said something another screen denied
(REVIEW-S823, signed-in walk 2026-11-19).

1. With no viewing time open, the rental page said 'Steady. Renters are
   coming in and booking' and 'Viewings are booking' while Today said
   renters cannot book. The demand check and the progress line now take
   the open viewing times and say renters cannot book.
2. Units with live ads read 'Ready to post' or 'Photos are in' because
   nobody tapped 'Ads are up'. With a live ad saved, a before-posting
   stage shows as 'Ads are up' on Today, Rentals and the rental page.
3. Reports said 'Leased 0' in a window where rentals were marked rented.
   The top card now counts rentals marked rented (leased_outcomes) and
   uses their days on the market when no lease date is recorded.
4. Renters kept open renters on long-rented units under 'Working'. They
   now sit in their own group below. No renter's status is changed.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGngsKqF4sZh6eWxsjC"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
