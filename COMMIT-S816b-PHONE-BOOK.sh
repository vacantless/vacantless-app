#!/bin/bash
# S816b: Phone book. Run after COMMIT-S816a and after COPY-SQL-0305.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
LOG=$(git log --oneline -10); case "$LOG" in *S816a*) ;; *) echo "STOP: run COMMIT-S816a-APPLICATIONS-OFFERS.sh first"; exit 1;; esac
npx tsc --noEmit -p .
npx tsx scripts/test-s816b-phone-book.ts
npx tsx scripts/test-s816-application-offer.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add app/dashboard/numbers/page.tsx app/dashboard/numbers/phone-search.tsx app/dashboard/numbers/actions.ts \
  lib/phone-book.ts app/dashboard/dashboard-nav.tsx app/page.tsx "app/dashboard/leads/[id]/application-card.tsx" \
  scripts/test-s816b-phone-book.ts scripts/test-plain-language.ts scripts/plain-language-baseline.json \
  supabase/migrations/0305_teammate_mobile.sql COPY-SQL-0305.sh \
  COMMIT-S816b-PHONE-BOOK.sh COMMIT-S816b-MESSAGE.txt
git commit -F COMMIT-S816b-MESSAGE.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
