#!/bin/bash
# S751d: L2 from a served N13.
set -eo pipefail
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit -p . && echo "tsc ok"
npx tsx scripts/test-s751-l2-n13.ts | tail -1
npx tsx scripts/test-s749-l2-n8.ts | tail -1
npx tsx scripts/test-s751-n13.ts | tail -1
npx tsx scripts/test-plain-language.ts | tail -1
echo "== commit"
git add lib/l2.ts lib/l2-official-pdf.ts "app/dashboard/tenancies/[id]/l2/official/route.ts" \
  "app/dashboard/tenancies/[id]/l2-section.tsx" "app/dashboard/tenancies/[id]/page.tsx" \
  scripts/test-s751-l2-n13.ts COMMIT-S751d-L2-N13.sh COMMIT-S751d-MESSAGE.txt
git commit -F COMMIT-S751d-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
