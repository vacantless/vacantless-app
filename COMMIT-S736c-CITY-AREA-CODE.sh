#!/bin/bash
# S736c: area code from the city name. One file pair, one script (rule 284).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-texting-numbers.ts
npm run build
echo "== commit"
git add lib/texting-numbers.ts scripts/test-texting-numbers.ts COMMIT-S736c-CITY-AREA-CODE.sh COMMIT-S736c-MESSAGE.txt
git commit -F COMMIT-S736c-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
