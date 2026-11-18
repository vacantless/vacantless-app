#!/bin/bash
# S816a: signed applications, co-applicants, agent send, offers, credit check link.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "submit_rental_application_signed" "app/apply/[token]/actions.ts" || { echo "STOP: S816a edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s816-application-offer.ts
npx tsx scripts/test-honest-claims.ts
npx tsx scripts/test-chat-leads.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add "app/agent/[token]/actions.ts" "app/agent/[token]/page.tsx" \
  "app/apply/[token]/actions.ts" "app/apply/[token]/page.tsx" \
  "app/offer/[token]/actions.ts" "app/offer/[token]/page.tsx" \
  "app/dashboard/leads/[id]/application/print/route.ts" "app/dashboard/leads/[id]/page.tsx" \
  "app/dashboard/leads/[id]/application-card.tsx" app/dashboard/leads/actions.ts \
  "app/dashboard/people/[id]/page.tsx" app/dashboard/settings/actions.ts app/dashboard/settings/page.tsx \
  "app/dashboard/tenancies/[id]/page.tsx" app/dashboard/tenancies/actions.ts app/dashboard/tenancies/new/page.tsx \
  app/page.tsx lib/email.ts lib/org.ts lib/rental-application-summary.ts lib/rental-application.ts \
  lib/application-offer.ts lib/rental-application-server.ts components/signed-papers.tsx \
  scripts/test-s816-application-offer.ts scripts/test-honest-claims.ts scripts/test-chat-leads.ts \
  supabase/migrations/0304_application_signature_offers.sql COPY-SQL-0304.sh \
  COMMIT-S816a-APPLICATIONS-OFFERS.sh COMMIT-S816a-MESSAGE.txt
git commit -F COMMIT-S816a-MESSAGE.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
