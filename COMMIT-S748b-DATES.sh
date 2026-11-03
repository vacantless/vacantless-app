#!/bin/bash
# S748b: server-rendered date labels name a time zone. Run after S748a.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-s748-dates.ts
echo "== commit"
git add lib/dates.ts scripts/test-s748-dates.ts \
  app/dashboard/settings/team-section.tsx app/dashboard/settings/page.tsx app/dashboard/referrals/page.tsx \
  "app/dashboard/tenancies/[id]/documents-section.tsx" "app/dashboard/tenancies/[id]/page.tsx" \
  app/dashboard/admin/page.tsx app/dashboard/admin/concierge/page.tsx \
  "app/dashboard/properties/[id]/documents-section.tsx" "app/dashboard/properties/[id]/brokerage-request-card.tsx" \
  app/dashboard/maintenance/page.tsx components/rotessa-settings-card.tsx \
  components/tenancy-lease-section.tsx components/stripe-connect-settings-card.tsx \
  COMMIT-S748b-DATES.sh COMMIT-S748b-MESSAGE.txt
git commit -F COMMIT-S748b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
