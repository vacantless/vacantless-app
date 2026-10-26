#!/bin/bash
# S737d: refresh email uses the account's own date.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-renew-list.ts
npx tsx scripts/test-listing-health.ts
npx tsx scripts/test-s718-refresh-links.ts
npm run build
echo "== commit"
git add app/api/cron/distribution-freshness/route.ts scripts/test-renew-list.ts \
  COMMIT-S737d-REFRESH-DATE.sh COMMIT-S737d-MESSAGE.txt
git commit -F COMMIT-S737d-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
