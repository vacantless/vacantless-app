#!/bin/bash
# S751b: helper in the welcome email + getting started; L9 opens its section.
set -eo pipefail
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit -p . && echo "tsc ok"
npx tsx scripts/test-onboarding-emails.ts | tail -1
npx tsx scripts/test-onboarding-wizard.ts | tail -1
npx tsx scripts/test-s751-l9.ts | tail -1
npx tsx scripts/test-plain-language.ts | tail -1
echo "== commit"
git add components/helper-install-tip.tsx "app/dashboard/(wizard)/getting-started/page.tsx" \
  lib/onboarding-emails.ts scripts/test-onboarding-emails.ts "app/dashboard/tenancies/[id]/page.tsx" \
  COMMIT-S751b-HELPER-TIP.sh COMMIT-S751b-MESSAGE.txt
git commit -F COMMIT-S751b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
