#!/bin/bash
# S740e: Fable review fixes (renters can't book, needs-a-reply truth, renter form button, counts that agree, snapshot button).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
for t in dashboard-today lead-triage leasing-snapshot rental-readiness keep-fresh listing-health leasing-health plain-language; do
  npx tsx scripts/test-$t.ts
done
echo "== commit"
git add lib/lead-answered.ts lib/pipeline.ts lib/lead-triage.ts lib/dashboard-today.ts lib/leasing-snapshot.ts \
  lib/notifications.ts lib/proof-stats.ts lib/rental-readiness.ts \
  app/dashboard/page.tsx app/dashboard/leads/page.tsx app/dashboard/leads/triage-queue.tsx \
  app/api/cron/leasing-snapshot/route.ts "app/r/[propertyId]/inquiry-form.tsx" \
  app/dashboard/properties/page.tsx app/dashboard/properties/readiness-chips.tsx \
  "app/dashboard/properties/[id]/page.tsx" "app/dashboard/properties/[id]/publish-everywhere.tsx" \
  scripts/test-dashboard-today.ts scripts/test-lead-triage.ts scripts/test-leasing-snapshot.ts scripts/test-rental-readiness.ts \
  COMMIT-S740e-REVIEW-FIXES.sh COMMIT-S740e-MESSAGE.txt
git commit -F COMMIT-S740e-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
