#!/bin/bash
# S739c: name the properties -> organizations link (PGRST201) in the results email and the renter page.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-org-embed-hint.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add app/api/cron/posted-results-email/route.ts "app/r/[propertyId]/page.tsx" scripts/test-org-embed-hint.ts \
  COMMIT-S739c-RESULTS-EMAIL-FIX.sh COMMIT-S739c-MESSAGE.txt
git commit -F COMMIT-S739c-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
