#!/bin/bash
# S742e: renters still waiting on a rental are told when it rents, with the other open homes.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
for t in rented-notice nurture renter-email-block s715-email-review s719-email-fixes plain-language; do
  npx tsx scripts/test-$t.ts
done
echo "== commit"
git add lib/rented-notice.ts lib/rented-notice-server.ts lib/email.ts lib/renter-email-block.ts \
  app/dashboard/properties/actions.ts app/dashboard/tenancies/actions.ts scripts/test-rented-notice.ts \
  COMMIT-S742e-RENTED-NOTICE.sh COMMIT-S742e-MESSAGE.txt
git commit -F COMMIT-S742e-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
