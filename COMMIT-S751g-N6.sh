#!/bin/bash
# S751g: Form N6 and L2 from an N6, plus Form L10 (S751h folded in: the
# tenancy page imports both sections, so they must ship in one commit).
set -eo pipefail
cd "$(dirname "$0")"
rm -f .git/index.lock
test -f lib/forms/ltb-n6-2026.pdf || { echo "STOP: lib/forms/ltb-n6-2026.pdf missing"; exit 1; }
test -f lib/forms/ltb-l10-2026.pdf || { echo "STOP: lib/forms/ltb-l10-2026.pdf missing"; exit 1; }
echo "== gates"
npx tsc --noEmit -p . && echo "tsc ok"
npx tsx scripts/test-s751-n6.ts | tail -1
npx tsx scripts/test-s751-l10.ts | tail -1
npx tsx scripts/test-s751-l9.ts | tail -1
npx tsx scripts/test-s751-l2-n13.ts | tail -1
npx tsx scripts/test-s749-l2-n8.ts | tail -1
npx tsx scripts/test-plain-language.ts | tail -1
echo "== commit"
git add lib/n6.ts lib/n6-official-pdf.ts lib/forms/ltb-n6-2026.pdf lib/l2.ts \
  app/dashboard/tenancies/n6-actions.ts "app/dashboard/tenancies/[id]/n6/official/route.ts" \
  "app/dashboard/tenancies/[id]/n6-section.tsx" "app/dashboard/tenancies/[id]/l2-section.tsx" \
  "app/dashboard/tenancies/[id]/page.tsx" next.config.mjs scripts/test-s751-n6.ts scripts/test-s751-l2-n13.ts \
  lib/l10.ts lib/l10-official-pdf.ts lib/forms/ltb-l10-2026.pdf \
  "app/dashboard/tenancies/[id]/l10/official/route.ts" "app/dashboard/tenancies/[id]/l10-section.tsx" \
  scripts/test-s751-l10.ts COMMIT-S751h-L10.sh COMMIT-S751h-MESSAGE.txt \
  COMMIT-S751g-N6.sh COMMIT-S751g-MESSAGE.txt
git commit -F COMMIT-S751g-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
