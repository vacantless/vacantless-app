#!/bin/bash
# S751e: homepage line about the Chrome helper.
set -eo pipefail
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit -p . && echo "tsc ok"
npx tsx scripts/test-plain-language.ts | tail -1
npx tsx scripts/test-posting-addon.ts | tail -1
echo "== commit"
git add app/page.tsx COMMIT-S751e-HOMEPAGE-HELPER.sh COMMIT-S751e-MESSAGE.txt
git commit -F COMMIT-S751e-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
