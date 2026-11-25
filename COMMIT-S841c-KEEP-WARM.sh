#!/bin/bash
# S841c: a 5-minute Vercel cron opens a tiny /warm page so the server copy the
# dashboard uses stays awake (45.5% of calls were cold starts).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
test -f app/warm/page.tsx || { echo "STOP: S841c page missing"; exit 1; }
grep -q '"/warm"' vercel.json || { echo "STOP: S841c cron missing"; exit 1; }
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s841c-keep-warm.ts
npx tsx scripts/test-canonical-host.ts
npx tsx scripts/test-s839-photo-size.ts
node scripts/run-all-tests.mjs
git add app/warm/page.tsx vercel.json app/robots.ts lib/canonical-host.ts \
  scripts/test-s841c-keep-warm.ts scripts/test-canonical-host.ts scripts/test-s839-photo-size.ts \
  COMMIT-S841c-KEEP-WARM.sh
git --no-pager diff --cached --name-only
git commit -m "S841c: keep one server copy awake with a 5-minute /warm cron

Vercel Observability (12 h to 2026-11-24 18:05): 45.5% of function calls
were cold starts; Today's P75 1.89 s. The first signed-in page after a
quiet spell took 2.4 to 3.0 s against 0.8 s warm. A public rental page
opened after 12 idle minutes (1.07 s) left the dashboard warm (0.79 s),
so one copy serves both. Vercel's cron now opens /warm every 5 minutes:
force-dynamic, reads nothing, not indexed, kept out of robots and the
host redirect. About 8,600 calls a month, inside the Pro allowance.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqaQEE8GeiwbwwdKXb"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
