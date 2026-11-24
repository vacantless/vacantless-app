#!/bin/bash
# S841a: Today logs where its time goes (WORKFLOW 418), before any speed fix.
# Logs only; removed once read.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "s841-today-timing" app/dashboard/page.tsx || { echo "STOP: S841a timing edit missing"; exit 1; }
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s841a-today-timing.ts
node scripts/run-all-tests.mjs
git add app/dashboard/page.tsx scripts/test-s841a-today-timing.ts COMMIT-S841a-TODAY-TIMING.sh
git --no-pager diff --cached --name-only
git commit -m "S841a: Today timing log

Today on Agile takes 1.2 to 2.0 s, the slowest daily page. Before choosing
a fix it logs 15 time marks to Vercel's logs ([s841-today-timing]): org,
agent, the main batch, answered, week, stages, rent adjustments, viewing
times, last week, counts, site tiles, coverage, renter emails, phone, end.
No renter data in the line. Removed once read.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqaQEE8GeiwbwwdKXb"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
