#!/bin/bash
# S748a: honest sweep failures, 60 s limits, repeat-failure email, page crash log.
# Migration 0269 is applied to prod by Claude before this runs (it fails safe
# without it: crashes are just not recorded and the email says "not checked").
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-s748-honest-sweeps.ts
npx tsx scripts/test-health-digest.ts
npx tsx scripts/test-sweep-timer.ts
echo "== commit"
git add lib/cron-sweeps.ts lib/app-errors.ts lib/health-digest.ts \
  app/api/cron app/api/report-error/route.ts app/error.tsx app/global-error.tsx \
  supabase/migrations/0269_app_errors.sql scripts/test-s748-honest-sweeps.ts \
  COMMIT-S748a-HONEST-SWEEPS.sh COMMIT-S748a-MESSAGE.txt
git commit -F COMMIT-S748a-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
