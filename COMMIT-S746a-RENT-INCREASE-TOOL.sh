#!/bin/bash
# S746a: free Ontario rent-increase calculator + filled Form N1. No migration.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-rent-increase-tool.ts
npx tsx scripts/test-ad-conversions.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add lib/rent-increase-tool.ts components/rent-increase-tool.tsx \
  app/tools/rent-increase/page.tsx app/tools/rent-increase/n1/route.ts \
  app/tools/rent-increase/n1/official/route.ts \
  components/marketing-chrome.tsx app/sitemap.ts lib/ad-conversions.ts \
  scripts/test-rent-increase-tool.ts \
  COMMIT-S746a-RENT-INCREASE-TOOL.sh COMMIT-S746a-MESSAGE.txt
git commit -F COMMIT-S746a-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
