#!/bin/bash
# S740b: health email lists robot posts only for robot-posting accounts.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-health-digest.ts
echo "== commit"
git add app/api/cron/health-digest/route.ts COMMIT-S740b-HEALTH-ROBOT-ORGS.sh COMMIT-S740b-MESSAGE.txt
git commit -F COMMIT-S740b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
