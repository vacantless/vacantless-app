#!/bin/bash
# S835c: a failed rent debit records Stripe's fee as an expense and adds an
# editable NSF charge to the tenancy, with a guidance note. Migration 0325 is
# already applied.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
test -f lib/nsf-charge-server.ts || { echo "STOP: lib/nsf-charge-server.ts missing"; exit 1; }
test -f supabase/migrations/0325_nsf_charges.sql || { echo "STOP: migration 0325 missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s835c-nsf-charges.ts
npx tsx scripts/test-stripe-rent-stop.ts
npx tsx scripts/test-stripe-webhook.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0325_nsf_charges.sql lib/nsf-charge.ts lib/nsf-charge-server.ts \
  app/dashboard/tenancies/nsf-actions.ts components/tenancy-nsf-charges.tsx \
  "app/dashboard/tenancies/[id]/page.tsx" app/api/stripe/webhook/route.ts \
  scripts/test-s835c-nsf-charges.ts scripts/test-stripe-rent-stop.ts scripts/test-stripe-webhook.ts \
  COMMIT-S835c-NSF-CHARGES.sh
git --no-pager diff --cached --name-only
git commit -m "S835c: NSF charges on a tenancy, and the failed-payment fee as an expense

Noam: NSFs have charges too. When a tenant's Stripe rent debit fails:
- Stripe's \$5.00 fee is recorded as an expense on that rental (merchant
  Stripe, the note says Vacantless recorded it).
- An NSF charge is added to the tenancy: the bank charge filled in, the
  admin charge empty. One per failed invoice.
The landlord can change both amounts, add a charge by hand (a bounced
cheque, a Rotessa NSF), mark it paid or remove it. The admin charge is
capped at \$20 in the form, the action and the table. A guidance note
says what Ontario's rule covers (O. Reg. 516/06, s. 17), that it names
cheques so the admin charge on a failed bank debit is not settled, to
keep NSF charges off an N4, and that it is not legal advice. It is a
record only: nothing here takes money from the tenant.

Migration 0325 (tenancy_nsf_charges) is applied.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqgtQ1cMJNk8rr2K6R"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
