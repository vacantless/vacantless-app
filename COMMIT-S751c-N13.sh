#!/bin/bash
# S751c: Form N13.
set -eo pipefail
cd "$(dirname "$0")"
rm -f .git/index.lock
test -f lib/forms/ltb-n13-2026.pdf || { echo "STOP: lib/forms/ltb-n13-2026.pdf missing"; exit 1; }
echo "== gates"
npx tsc --noEmit -p . && echo "tsc ok"
npx tsx scripts/test-s751-n13.ts | tail -1
npx tsx scripts/test-s748-n12.ts | tail -1
npx tsx scripts/test-s751-l9.ts | tail -1
npx tsx scripts/test-plain-language.ts | tail -1
echo "== commit"
git add lib/n13.ts lib/n13-snapshot.ts lib/n13-official-pdf.ts lib/n12.ts lib/forms/ltb-n13-2026.pdf \
  app/dashboard/tenancies/n13-actions.ts "app/dashboard/tenancies/[id]/n13/official/route.ts" \
  "app/dashboard/tenancies/[id]/n13-section.tsx" "app/dashboard/tenancies/[id]/page.tsx" next.config.mjs \
  scripts/test-s751-n13.ts COMMIT-S751c-N13.sh COMMIT-S751c-MESSAGE.txt
git commit -F COMMIT-S751c-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
