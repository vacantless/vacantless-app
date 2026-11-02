#!/bin/bash
# S742f: N4 minimum notice is 7 days for every tenancy from 2026-09-21 (Bill 60).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
for t in n4 n4-snapshot n4-pdf plain-language; do
  npx tsx scripts/test-$t.ts
done
echo "== commit"
git add lib/n4.ts scripts/test-n4.ts "app/dashboard/tenancies/[id]/n4-section.tsx" \
  COMMIT-S742f-N4-SEVEN-DAYS.sh COMMIT-S742f-MESSAGE.txt
git commit -F COMMIT-S742f-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
