#!/bin/bash
# S740f: Rentals list Renew box sends Facebook to Your listings and records nothing.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-keep-fresh.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add app/dashboard/properties/renew-list-card.tsx scripts/test-keep-fresh.ts COMMIT-S740f-RENEW-LIST-LINK.sh COMMIT-S740f-MESSAGE.txt
git commit -F COMMIT-S740f-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
