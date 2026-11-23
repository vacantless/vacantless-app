#!/bin/bash
# S832a: marketing pass and the "pays for itself" table (PLAN-S829 items 4, 4b).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'export const VENDOR_COSTS' lib/vendor-costs.ts || { echo "STOP: S832a edit missing"; exit 1; }
# The before/after pair: a real Pillette photo from the test rental, touched up by lib/photo-touchup.ts.
B="https://nvhvdyxpyogvadpjlvij.supabase.co/storage/v1/object/public/property-photos/8ea1da48-0cd2-45a4-bfba-023b31a67884/46def756-bb4e-4077-b87c-14ac68566692/3001b7f6-8f8c-4c35-917f-de3edc10a87a"
curl -fsS -o public/marketing/touchup-before.jpg "$B-original.jpg"
curl -fsS -o public/marketing/touchup-after.jpg "$B.jpg"
sips -Z 1000 public/marketing/touchup-before.jpg public/marketing/touchup-after.jpg >/dev/null
ls -l public/marketing/touchup-before.jpg public/marketing/touchup-after.jpg
npx tsc --noEmit -p .
npx tsx scripts/test-s832-vendor-costs.ts
node scripts/run-all-tests.mjs
git add lib/billing.ts lib/vendor-costs.ts lib/friction-pages.ts components/vendor-cost-table.tsx app/page.tsx app/dashboard/billing/page.tsx scripts/test-s832-vendor-costs.ts public/marketing/touchup-before.jpg public/marketing/touchup-after.jpg COMMIT-S832a-MARKETING-PASS-VENDOR-TABLE.sh
git diff --cached --name-only
git commit -m "S832a: marketing pass and the pays-for-itself table

Paid plan list regrouped by job (Find renters, Viewings, Applications and
paperwork, Rent and repairs, Reports and year-end), every line checked
against the code: data sheet import, lease reading, Send to Vacantless and
the monthly report named; the trade-network, bank-feed and ads-down lines
narrowed to what is live. Billing band cards show their limits and one
grouped list below. New homepage section: data sheet and lease reading, and
a real touch-up before/after. lib/vendor-costs.ts: seven typical outside
prices, each with its source and date, on the homepage and billing page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGoZLAxBr3cq3Dgcj6r"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
