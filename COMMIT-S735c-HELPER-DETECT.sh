#!/bin/bash
# S735c: the rental page finds the Marketplace helper even when it starts late.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-marketplace-helper.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add "app/dashboard/properties/[id]/marketplace-row.tsx" COMMIT-S735c-HELPER-DETECT.sh COMMIT-S735c-MESSAGE.txt
git commit -F COMMIT-S735c-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
