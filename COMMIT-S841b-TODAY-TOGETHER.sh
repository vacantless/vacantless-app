#!/bin/bash
# S841b: Today starts the calls that waited one after another together; the
# S841a timing log is removed.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "const droppedAdsEarly = early(" app/dashboard/page.tsx || { echo "STOP: S841b edit missing"; exit 1; }
if grep -q "s841-today-timing" app/dashboard/page.tsx; then echo "STOP: timing log still in"; exit 1; fi
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s841a-today-timing.ts
npx tsx scripts/test-s839c-early-request-cache.ts
node scripts/run-all-tests.mjs
git add app/dashboard/page.tsx scripts/test-s841a-today-timing.ts \
  scripts/test-s839c-early-request-cache.ts COMMIT-S841b-TODAY-TOGETHER.sh
git --no-pager diff --cached --name-only
git commit -m "S841b: Today starts its waiting calls together; timing log removed

The S841a log on Agile (339 renters, 4 loads) put the page's data at about
1.0 s warm, of which about 0.6 s was calls made one after another that do
not need each other: posting coverage and removed ads (160 to 310 ms), the
phone-reply check (35 to 285 ms), renter emails, crew stages, viewing-time
count and this week's viewings. They now start with the main batch
(early()) and are awaited where used. Same reads, same gates (posting set
up, wizard on); nothing on screen changes. The timing marks are gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqaQEE8GeiwbwwdKXb"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
