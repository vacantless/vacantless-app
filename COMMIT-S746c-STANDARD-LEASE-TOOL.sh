#!/bin/bash
# S746c: free Ontario Standard Lease filler. No migration.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-standard-lease-tool.ts
npx tsx scripts/test-standard-lease.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add lib/standard-lease-tool.ts app/tools/standard-lease/page.tsx \
  app/tools/standard-lease/pdf/route.ts \
  components/marketing-chrome.tsx app/sitemap.ts \
  scripts/test-standard-lease-tool.ts \
  COMMIT-S746c-STANDARD-LEASE-TOOL.sh COMMIT-S746c-MESSAGE.txt
git commit -F COMMIT-S746c-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
