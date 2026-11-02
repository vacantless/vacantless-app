#!/bin/bash
# S742j: renter rows group by email, phone or name.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-renter-rows.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add lib/renter-rows.ts scripts/test-renter-rows.ts "app/dashboard/properties/[id]/page.tsx" \
  COMMIT-S742j-RENTER-ROWS-PHONE.sh COMMIT-S742j-MESSAGE.txt
git commit -F COMMIT-S742j-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
