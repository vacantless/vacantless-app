#!/bin/bash
# S742d: closeAccount removes site logins, bank tokens, sign-in windows and the texting number.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-account-closure-server.ts
npx tsx scripts/test-account-closure.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add lib/account-closure-server.ts scripts/test-account-closure-server.ts app/dashboard/settings/actions.ts \
  COMMIT-S742d-CLOSE-ACCOUNT-WIPES-SECRETS.sh COMMIT-S742d-MESSAGE.txt
git commit -F COMMIT-S742d-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
