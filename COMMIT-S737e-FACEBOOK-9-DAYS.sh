#!/bin/bash
# S737e: Facebook Marketplace refresh window 9 days.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-distribution-channels.ts
npx tsx scripts/test-renew-list.ts
npx tsx scripts/test-listing-health.ts
npm run build
echo "== commit"
git add lib/distribution-channels.ts scripts/test-distribution-channels.ts scripts/test-renew-list.ts \
  COMMIT-S737e-FACEBOOK-9-DAYS.sh COMMIT-S737e-MESSAGE.txt
git commit -F COMMIT-S737e-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
