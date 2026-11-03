#!/bin/bash
# S747d: Realtor.ca brokerage card behind BROKERAGE_CARD_ENABLED. No migration.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-brokerage-request.ts
echo "== commit"
git add lib/brokerage-request.ts "app/dashboard/properties/[id]/page.tsx" \
  "app/dashboard/properties/[id]/brokerage-actions.ts" scripts/test-brokerage-request.ts \
  COMMIT-S747d-BROKERAGE-OFF.sh COMMIT-S747d-MESSAGE.txt
git commit -F COMMIT-S747d-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
