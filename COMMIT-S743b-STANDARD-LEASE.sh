#!/bin/bash
# S743b: Ontario Standard Lease (2229E). Migration 0264 must be applied first.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-standard-lease.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add lib/standard-lease.ts lib/standard-lease-pdf.ts lib/standard-lease-server.ts \
  lib/forms/ontario-2229e-2020-12-flat.pdf supabase/migrations/0264_lease_standard_form.sql \
  "app/dashboard/tenancies/[id]/lease/[leaseId]/standard/page.tsx" \
  "app/dashboard/tenancies/[id]/lease/[leaseId]/standard/actions.ts" \
  "app/dashboard/tenancies/[id]/lease/[leaseId]/standard/pdf/route.ts" \
  components/tenancy-lease-section.tsx next.config.mjs scripts/test-standard-lease.ts \
  COMMIT-S743b-STANDARD-LEASE.sh COMMIT-S743b-MESSAGE.txt
git commit -F COMMIT-S743b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
