#!/bin/bash
# S744b: Billing tells a teammate only the owner can change it.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-team-invites.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add app/dashboard/billing/page.tsx scripts/test-team-invites.ts \
  COMMIT-S744b-BILLING-OWNER-LINE.sh COMMIT-S744b-MESSAGE.txt
git commit -F COMMIT-S744b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
