#!/bin/bash
# S751i: health email skips Noam's test accounts.
set -eo pipefail
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit -p . && echo "tsc ok"
npx tsx scripts/test-health-digest.ts | tail -1
npx tsx scripts/test-quiet-orgs.ts | tail -1
echo "== commit"
git add lib/quiet-orgs.ts app/api/cron/health-digest/route.ts scripts/test-health-digest.ts \
  COMMIT-S751i-HEALTH-QUIET.sh COMMIT-S751i-MESSAGE.txt
git commit -F COMMIT-S751i-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
