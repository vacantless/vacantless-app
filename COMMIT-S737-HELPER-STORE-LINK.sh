#!/bin/bash
# S737: the helper install link points at the approved store page.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-marketplace-helper.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add lib/marketplace-helper.ts "app/dashboard/properties/[id]/marketplace-row.tsx" \
  scripts/test-marketplace-helper.ts \
  COMMIT-S737-HELPER-STORE-LINK.sh COMMIT-S737-MESSAGE.txt
git commit -F COMMIT-S737-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
