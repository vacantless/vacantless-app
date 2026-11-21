#!/bin/bash
# S825c: a dropped connection retries the page once instead of showing a crash.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s748-honest-sweeps.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add app/error.tsx lib/app-errors.ts app/api/cron/health-digest/route.ts scripts/test-s748-honest-sweeps.ts COMMIT-S825c-CONNECTION-DROP-RETRY.sh
git commit -m "S825c: a dropped connection reloads the page instead of a crash screen

The Nov 21 health email counted two page crashes, both Safari Load failed
(/phone on Nov 20 10:39, fixed in S825a, and /dashboard/replies at 11:02).
Load failed is a dropped connection, not a bug. The error page now tries
the page again once (server refresh) and logs it as network; a second
failure within 30 seconds shows the normal crash page and counts. The
health email leaves network drops out of Page crashes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGnzykYaE5HoHtPVQ2C"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
