#!/bin/bash
# S737b: results email and forwarding card gate. Migration 0262 is applied.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-posted-results-email.ts
npx tsx scripts/test-posted-results.ts
npx tsx scripts/test-plain-language.ts --update-baseline
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add supabase/migrations/0262_posted_results_email.sql \
  lib/posted-results-email.ts app/api/cron/posted-results-email/route.ts \
  lib/cron-sweeps.ts .github/workflows/reminders.yml \
  app/dashboard/link-portals/page.tsx \
  scripts/test-posted-results-email.ts scripts/test-plain-language.ts scripts/plain-language-baseline.json \
  COMMIT-S737b-RESULTS-EMAIL.sh COMMIT-S737b-MESSAGE.txt
git commit -F COMMIT-S737b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
