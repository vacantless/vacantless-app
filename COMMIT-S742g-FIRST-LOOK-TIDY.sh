#!/bin/bash
# S742g: renters tab grouping, Posting card button, checklist counts only future custom dates.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
for t in renter-rows onboarding-wizard s714d-run-fixes plain-language; do
  npx tsx scripts/test-$t.ts
done
echo "== commit"
git add lib/renter-rows.ts scripts/test-renter-rows.ts scripts/test-s714d-run-fixes.ts "app/dashboard/properties/[id]/page.tsx" \
  app/page.tsx lib/signup-copy.ts app/onboarding/actions.ts \
  "app/dashboard/(wizard)/getting-started/page.tsx" app/dashboard/page.tsx \
  COMMIT-S742g-FIRST-LOOK-TIDY.sh COMMIT-S742g-MESSAGE.txt
git commit -F COMMIT-S742g-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
