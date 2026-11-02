#!/bin/bash
# S742c: claim-then-send on the seven sending sweeps.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
for t in claim-stamp reminders nurture onboarding-emails posted-results-email confirmation-nudge signin-lost landlord-campaign plain-language; do
  npx tsx scripts/test-$t.ts
done
echo "== commit"
git add lib/claim-stamp.ts scripts/test-claim-stamp.ts scripts/test-onboarding-emails.ts scripts/test-signin-lost.ts \
  app/api/cron/reminders/route.ts app/api/cron/nurture/route.ts app/api/cron/onboarding-emails/route.ts \
  app/api/cron/posted-results-email/route.ts app/api/cron/showing-confirmation-nudge/route.ts \
  app/api/cron/signin-lost/route.ts app/api/cron/landlord-campaign/route.ts \
  COMMIT-S742c-CLAIM-THEN-SEND.sh COMMIT-S742c-MESSAGE.txt
git commit -F COMMIT-S742c-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
