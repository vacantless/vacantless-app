#!/bin/bash
# S818a: one credit check per vacancy (Ask for credit check), free LTB order search on Ontario rentals.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s818-credit-check.ts
npx tsx scripts/test-s816-application-offer.ts
npx tsx scripts/test-honest-claims.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/credit-check.ts lib/email.ts "app/apply/[token]/page.tsx" \
  "app/dashboard/leads/[id]/application-card.tsx" "app/dashboard/leads/[id]/page.tsx" app/dashboard/leads/actions.ts \
  app/dashboard/settings/page.tsx app/page.tsx supabase/migrations/0308_credit_check_on_ask.sql \
  scripts/test-s818-credit-check.ts scripts/test-honest-claims.ts COMMIT-S818a-ONE-CREDIT-CHECK-LTB.sh
git commit -m "S818a: one credit check per vacancy, free LTB check on Ontario rentals

Applicants got the credit check link the moment they signed, so a landlord
paid for a report on every applicant. In Ontario the landlord pays and cannot
charge the applicant (RTA). Now the link goes only to the applicant the
landlord presses Ask for credit check on (email, or copy and text); 0308
withholds it from the public read until then. Each signed applicant on an
Ontario rental gets a free Check LTB orders link (CanLII, published orders).
The rule's words live in lib/credit-check.ts: renter page, Settings,
homepage.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGokzebAsp6GCX7VNvL"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
