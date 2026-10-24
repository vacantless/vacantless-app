#!/bin/bash
# S736b: texting numbers buy, set up and release themselves. Migration 0259
# is already applied. One script for every file it touches (rule 284).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-texting-numbers.ts
npx tsx scripts/test-sweep-timer.ts
npx tsx scripts/test-texting-setup-emails.ts
npx tsx scripts/test-org-sms-numbers.ts
npx tsx scripts/test-sms.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add supabase/migrations/0259_texting_numbers_auto.sql \
  lib/texting-numbers.ts lib/texting-numbers-server.ts \
  app/api/cron/texting-numbers/route.ts \
  lib/cron-sweeps.ts .github/workflows/reminders.yml \
  app/dashboard/settings/actions.ts app/dashboard/settings/page.tsx \
  app/dashboard/admin/actions.ts app/dashboard/admin/org-sms-numbers-section.tsx \
  scripts/test-texting-numbers.ts \
  COMMIT-S736b-TEXTING-NUMBERS.sh COMMIT-S736b-MESSAGE.txt
git commit -F COMMIT-S736b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
