#!/bin/bash
# S738: Rentals.ca account already in use, in plain words.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-s724-posting-stop.ts
npx tsx scripts/test-site-signin.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add lib/distribution-publish.ts lib/site-signin.ts scripts/test-s724-posting-stop.ts scripts/test-site-signin.ts \
  COMMIT-S738-RENTALS-ACCOUNT-IN-USE.sh COMMIT-S738-MESSAGE.txt
git commit -F COMMIT-S738-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
