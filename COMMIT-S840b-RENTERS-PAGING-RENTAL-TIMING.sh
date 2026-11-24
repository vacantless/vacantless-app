#!/bin/bash
# S840b (REVIEW-S839 step H, first part): the Renters list shows the first 20
# renters of each group (Needs you now in full) with "Show all", and the
# rental page logs where its time goes (logs only, removed once read).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "export const BUCKET_PREVIEW = 20;" app/dashboard/leads/triage-queue.tsx || { echo "STOP: S840b paging edit missing"; exit 1; }
grep -q "s840-rental-timing" "app/dashboard/properties/[id]/page.tsx" || { echo "STOP: S840b timing edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s840b-renters-paging.ts
node scripts/run-all-tests.mjs
git add app/dashboard/leads/triage-queue.tsx app/dashboard/leads/page.tsx \
  "app/dashboard/properties/[id]/page.tsx" scripts/test-s840b-renters-paging.ts \
  COMMIT-S840b-RENTERS-PAGING-RENTAL-TIMING.sh
git --no-pager diff --cached --name-only
git commit -m "S840b: Renters shows 20 per group with Show all; rental page timing log

REVIEW-S839 step H, first part.
- Renters: on Agile the page was 1.09 MB (331 renters, each with a stage
  picker). Every group except Needs you now shows its first 20, most
  actionable first, with Show all N (?all=1, filters kept, jumps to the
  group). Chip and group counts stay whole.
- Rental page: the body arrives about 1.3 s after the loading screen.
  Before choosing between more parallel questions and a split page, it logs
  four time marks to Vercel's logs ([s840-rental-timing]). Removed once read.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMLwSHQkDAVv4gVne"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
