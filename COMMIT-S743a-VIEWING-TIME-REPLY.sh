#!/bin/bash
# S743a: renter replies say "pick a viewing time" only when one exists.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-renter-message-reply.ts
npx tsx scripts/test-helper-ad-list.ts
npx tsx scripts/test-marketplace-helper.ts
npx tsx scripts/test-listing-copy.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add lib/rental-viewing-times.ts lib/listing-copy.ts lib/marketplace-helper.ts lib/marketplace-helper-server.ts \
  "app/dashboard/properties/[id]/page.tsx" "app/kit/[token]/page.tsx" "app/agent/[token]/marketplace/[propertyId]/page.tsx" \
  scripts/test-renter-message-reply.ts scripts/test-helper-ad-list.ts \
  COMMIT-S743a-VIEWING-TIME-REPLY.sh COMMIT-S743a-MESSAGE.txt
git commit -F COMMIT-S743a-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
