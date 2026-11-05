#!/bin/bash
# S751f: cron header-only, security headers, link signing key.
set -eo pipefail
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit -p . && echo "tsc ok"
npx tsx scripts/test-s751-cron-header-only.ts | tail -1
npx tsx scripts/test-s751-link-signing.ts | tail -1
npx tsx scripts/test-landlord-campaign.ts | tail -1
npx tsx scripts/test-reschedule-nudge.ts | tail -1
npx tsx scripts/test-marketplace-phone.ts | tail -1
npx tsx scripts/test-plain-language.ts | tail -1
echo "== commit"
git add app/api/cron/*/route.ts next.config.mjs lib/link-signing.ts lib/viewing-calendar-server.ts lib/calendar-feed-server.ts \
  lib/renter-unsubscribe-server.ts lib/marketplace-phone-link.ts lib/marketplace-kit-server.ts \
  "app/unsubscribe/[token]/actions.ts" "app/unsubscribe/[token]/page.tsx" \
  scripts/test-s751-cron-header-only.ts scripts/test-s751-link-signing.ts scripts/test-landlord-campaign.ts \
  scripts/test-reschedule-nudge.ts COMMIT-S751f-SECURITY.sh COMMIT-S751f-MESSAGE.txt
git commit -F COMMIT-S751f-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
