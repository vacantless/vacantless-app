#!/bin/bash
# S810a: the demand check sits under the progress line on a rental's page.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit
node scripts/run-all-tests.mjs
cat > /tmp/s810a-msg.txt <<'MSG'
S810a: "How this rental is doing" sits under the progress line

The demand check (S807) was inside the Details tab, below the photo and
address boxes, so a landlord had to open a tab to see whether the ad is
working. It now shows right under the progress line at the top of the
rental page, for available rentals only (unchanged rule).

- app/dashboard/properties/[id]/page.tsx: DemandCheckPanel moved from the
  Details tab to under UnitJourneyLine, in an mb-4 wrapper.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGpJw1qpEmwofw8Q9vq
MSG
git add "app/dashboard/properties/[id]/page.tsx" COMMIT-S810a-DEMAND-NEXT-TO-PROGRESS.sh
git commit -F /tmp/s810a-msg.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
