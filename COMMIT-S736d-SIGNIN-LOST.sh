#!/bin/bash
# S736d: sign-out email and the server Node line. Migration 0260 must be
# applied in Supabase first (the new route reads its column).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-signin-lost.ts
npx tsx scripts/test-health-digest.ts
npx tsx scripts/test-sweep-timer.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add supabase/migrations/0260_signin_lost_notified.sql \
  lib/signin-lost.ts app/api/cron/signin-lost/route.ts \
  lib/health-digest.ts app/api/cron/health-digest/route.ts app/api/cron/sweep-all/route.ts \
  lib/cron-sweeps.ts .github/workflows/reminders.yml \
  scripts/test-signin-lost.ts scripts/test-health-digest.ts \
  scripts/test-plain-language.ts scripts/plain-language-baseline.json \
  COMMIT-S736d-SIGNIN-LOST.sh COMMIT-S736d-MESSAGE.txt
git commit -F COMMIT-S736d-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
