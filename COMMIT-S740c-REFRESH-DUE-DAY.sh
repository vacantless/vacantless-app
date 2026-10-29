#!/bin/bash
# S740c: refresh reminder not held back by an alert sent before the ad was due.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-listing-health.ts
echo "== commit"
git add lib/listing-health.ts scripts/test-listing-health.ts COMMIT-S740c-REFRESH-DUE-DAY.sh COMMIT-S740c-MESSAGE.txt
git commit -F COMMIT-S740c-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
