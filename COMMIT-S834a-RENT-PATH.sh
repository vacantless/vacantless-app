#!/bin/bash
# S834a: the rent-only path, fixed from the S834 stranger walk.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "S834a" app/dashboard/tenancies/actions.ts || { echo "STOP: S834a edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s834a-rent-path.ts
npx tsx scripts/test-s832-vendor-costs.ts
node scripts/run-all-tests.mjs
git add \
  app/dashboard/tenancies/actions.ts \
  app/dashboard/tenancies/new/page.tsx \
  app/dashboard/tenancies/new/lease-upload-prefill.tsx \
  "app/dashboard/tenancies/[id]/page.tsx" \
  lib/tenancy-section.ts \
  lib/rent-return.ts \
  app/dashboard/settings/stripe-connect-actions.ts \
  app/dashboard/settings/page.tsx \
  components/stripe-connect-settings-card.tsx \
  components/rotessa-settings-card.tsx \
  components/tenancy-stripe-rent-section.tsx \
  app/dashboard/money/page.tsx \
  components/rent-cost-table.tsx \
  app/page.tsx \
  lib/vendor-costs.ts \
  scripts/test-s832-vendor-costs.ts \
  components/auth-shell.tsx \
  app/signup/page.tsx \
  app/onboarding/page.tsx \
  app/onboarding/onboarding-form.tsx \
  app/onboarding/actions.ts \
  lib/onboarding-emails.ts \
  lib/onboarding-email-send.ts \
  lib/message-catalog.ts \
  scripts/test-s834a-rent-path.ts \
  COMMIT-S834a-RENT-PATH.sh
git --no-pager diff --cached --name-only
git commit -m "S834a: the rent-only path, from a stranger walk

A landlord who only collects rent hit a dead end: Add your first tenant
said Add the unit first, which opened the full leasing form. Now:
- Add a tenancy takes the rental address itself and makes a private unit
  after every check passes; it lands with Rent collection open.
- Connect Stripe button on the tenancy; Stripe's form returns to Settings
  with a link back to the tenant (internal tenancy paths only).
- Banking shows Stripe first; Rotessa says it costs less from 6 rentals.
- Rent sign-ups get a rent welcome and a rent next-day nudge (intent kept
  in organizations.signup_source), rent proof lines, no renter phone field;
  onboarding errors keep the plan. Show password on sign-up.
- Money page: the lease reader is Starter and up; no cheques line.
- Cost table names the one-time bank check (\$1 Stripe, \$2 Rotessa).
- Pays-for-itself table: a rent collection app line (Landlord Studio Pro,
  US\$12 a month), saying the payment fee still applies.
- Canada and US labels keep their capitals.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGogwZs9kDhv2v4gMSa"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
