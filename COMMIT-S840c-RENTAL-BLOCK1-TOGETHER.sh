#!/bin/bash
# S840c (REVIEW-S839 step H): the rental page's slowest block (650 to 1,180 ms
# on Agile by the S840b timing log) now starts its questions together.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "const slotChoiceEarly = early(" "app/dashboard/properties/[id]/page.tsx" || { echo "STOP: S840c rental edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s839c-early-request-cache.ts
node scripts/run-all-tests.mjs
git add "app/dashboard/properties/[id]/page.tsx" scripts/test-s839c-early-request-cache.ts \
  COMMIT-S840c-RENTAL-BLOCK1-TOGETHER.sh
git --no-pager diff --cached --name-only
git commit -m "S840c: rental page block 1 questions start together

REVIEW-S839 step H. The S840b timing log on Agile: data 1.3 to 1.8 s,
building the page about 0.25 s. The block after the rental row (unit stage,
Rentals.ca slot wait and choice, made-room, viewing times count, viewings by
request, has viewing times, post-lease, robot access, posting coverage,
booking settings) waited 650 to 1,180 ms one after another. They now start
with the other early() questions; the slot wait -> choice and robot access
-> coverage pairs run as one chain each. No query, filter or logic changed.
Timing marks stay in the log to measure the gain.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMLwSHQkDAVv4gVne"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
