#!/bin/bash
# S740d: Facebook Renew opens Your listings and records nothing; email and card say where Renew is.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-keep-fresh.ts
npx tsx scripts/test-listing-health.ts
echo "== commit"
git add "app/dashboard/properties/[id]/keep-fresh-card.tsx" lib/keep-fresh.ts lib/notifications.ts scripts/test-keep-fresh.ts \
  COMMIT-S740d-FACEBOOK-RENEW-LINK.sh COMMIT-S740d-MESSAGE.txt
git commit -F COMMIT-S740d-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
