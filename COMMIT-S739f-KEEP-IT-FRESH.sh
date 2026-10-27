#!/bin/bash
# S739f: one "Keep it fresh" card (review item 10).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-keep-fresh.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git rm -q "app/dashboard/properties/[id]/renew-ads-card.tsx" "app/dashboard/properties/[id]/page-weekly-posts-card.tsx"
git add lib/keep-fresh.ts "app/dashboard/properties/[id]/keep-fresh-card.tsx" "app/dashboard/properties/[id]/page.tsx" \
  scripts/test-keep-fresh.ts scripts/test-plain-language.ts scripts/plain-language-baseline.json \
  COMMIT-S739f-KEEP-IT-FRESH.sh COMMIT-S739f-MESSAGE.txt
git commit -F COMMIT-S739f-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
