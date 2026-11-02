#!/bin/bash
# S744c: Ontario Standard Lease signed on page 7, frozen at send. No migration.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-standard-lease.ts
npx tsx scripts/test-standard-lease-signatures.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add lib/standard-lease.ts lib/standard-lease-pdf.ts lib/standard-lease-server.ts \
  "app/dashboard/tenancies/[id]/lease-actions.ts" \
  "app/dashboard/tenancies/[id]/lease/[leaseId]/standard/pdf/route.ts" \
  scripts/test-standard-lease-signatures.ts \
  COMMIT-S744c-LEASE-SIGNATURES.sh COMMIT-S744c-MESSAGE.txt
git commit -F COMMIT-S744c-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
