#!/bin/bash
# S737c: Renew box on the rentals list, refresh email button, pricing proof.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-renew-list.ts
npx tsx scripts/test-s718-refresh-links.ts
npx tsx scripts/test-listing-health.ts
npx tsx scripts/test-s715-email-review.ts
npx tsx scripts/test-renew-ads.ts
npx tsx scripts/test-plain-language.ts --update-baseline
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add lib/listing-health.ts lib/notifications.ts lib/proof-stats.ts app/page.tsx \
  app/dashboard/properties/actions.ts app/dashboard/properties/page.tsx app/dashboard/properties/renew-list-card.tsx lib/renew-list-load.ts \
  scripts/test-renew-list.ts scripts/test-s718-refresh-links.ts scripts/test-plain-language.ts scripts/plain-language-baseline.json \
  COMMIT-S737c-RENEW-BOX-PROOF.sh COMMIT-S737c-MESSAGE.txt
git commit -F COMMIT-S737c-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
