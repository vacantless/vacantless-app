#!/bin/bash
# S751: Form L9 (collect rent, tenant still there).
set -eo pipefail
cd "$(dirname "$0")"
rm -f .git/index.lock
test -f lib/forms/ltb-l9-2026.pdf || { echo "STOP: lib/forms/ltb-l9-2026.pdf missing"; exit 1; }
echo "== gates"
npx tsc --noEmit -p . && echo "tsc ok"
npx tsx scripts/test-s751-l9.ts | tail -1
npx tsx scripts/test-s748-l1.ts | tail -1
npx tsx scripts/test-plain-language.ts | tail -1
npx tsx scripts/test-lead-no-suitable-time.ts | tail -1
echo "== commit"
git add lib/l9.ts lib/l9-official-pdf.ts lib/l1-official-pdf.ts lib/forms/ltb-l9-2026.pdf \
  "app/dashboard/tenancies/[id]/l9/official/route.ts" "app/dashboard/tenancies/[id]/l9-section.tsx" \
  "app/dashboard/tenancies/[id]/page.tsx" next.config.* scripts/test-s751-l9.ts scripts/test-lead-no-suitable-time.ts \
  COMMIT-S751-L9.sh COMMIT-S751-MESSAGE.txt
git commit -F COMMIT-S751-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
