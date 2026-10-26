#!/bin/bash
# S739: save the Facebook renewals the helper sees (app half of helper 1.2.0).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-helper-renew.ts
npx tsx scripts/test-helper-ad-list.ts
npx tsx scripts/test-marketplace-helper.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add lib/marketplace-helper.ts lib/marketplace-helper-server.ts app/dashboard/marketplace-helper-actions.ts \
  components/marketplace-helper-sync.tsx app/dashboard/layout.tsx scripts/test-helper-renew.ts scripts/test-helper-ad-list.ts \
  COMMIT-S739-HELPER-RENEWALS.sh COMMIT-S739-MESSAGE.txt
git commit -F COMMIT-S739-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
