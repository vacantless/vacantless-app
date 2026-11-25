#!/bin/bash
# S841f: the /warm ping also asks the database and the sign-in service one
# tiny question each, and logs how long each took.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "auth/v1/health" app/warm/page.tsx || { echo "STOP: S841f edit missing"; exit 1; }
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s841c-keep-warm.ts
node scripts/run-all-tests.mjs
git add app/warm/page.tsx scripts/test-s841c-keep-warm.ts COMMIT-S841f-WARM-TOUCHES-DATABASE.sh
git --no-pager diff --cached --name-only
git commit -m "S841f: the keep-warm ping touches the database and the sign-in service

The S841e boot marks: the copy /warm keeps awake is the one that served the
first dashboard load after 16 idle minutes (boot hprxie, up 35 minutes), and
that load still took 3.25 s, with 1.4 s gone before the page started
(0.3 s when warm). A fresh copy 1.3 s old served the same page in 1.05 s,
so a cold start is not the cost; the idle path to the database is the
suspect. /warm now makes one head count and one auth health call and logs
their times with its boot mark. Measurement stays in until read.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqaQEE8GeiwbwwdKXb"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
