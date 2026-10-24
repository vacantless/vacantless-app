#!/bin/bash
# S736: review item 9, the Marketplace kit on the phone. One script for every
# file it touches (rule 284); the message is a file (rule 283).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-marketplace-phone.ts
npx tsx scripts/test-marketplace-kit.ts
npx tsx scripts/test-listing-distribution.ts
npx tsx scripts/test-marketplace-helper.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add lib/marketplace-kit.ts lib/marketplace-phone-link.ts lib/marketplace-phone-email.ts \
  lib/marketplace-kit-server.ts lib/listing-distribution.ts \
  components/marketplace-kit-steps.tsx \
  "app/kit/[token]/page.tsx" "app/kit/[token]/actions.ts" "app/kit/[token]/photos/route.ts" \
  "app/agent/[token]/marketplace/[propertyId]/page.tsx" \
  "app/dashboard/properties/[id]/page.tsx" \
  "app/dashboard/properties/[id]/marketplace-row.tsx" \
  "app/dashboard/properties/[id]/marketplace-actions.ts" \
  app/dashboard/properties/actions.ts app/robots.ts \
  scripts/test-marketplace-phone.ts scripts/test-marketplace-kit.ts \
  scripts/test-plain-language.ts scripts/plain-language-baseline.json \
  COMMIT-S736-MARKETPLACE-PHONE.sh COMMIT-S736-MESSAGE.txt
git commit -F COMMIT-S736-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
