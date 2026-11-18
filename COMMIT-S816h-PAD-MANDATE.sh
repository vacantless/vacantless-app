#!/bin/bash
# S816h: the bank authorization covers monthly rent (Stripe PAD default_for).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s816h-pad-mandate.ts
npx tsx scripts/test-stripe-connect.ts
npx tsx scripts/test-plain-language.ts
git add lib/stripe-connect.ts app/dashboard/tenancies/stripe-rent-actions.ts "app/dashboard/tenancies/[id]/page.tsx" scripts/test-s816h-pad-mandate.ts COMMIT-S816h-PAD-MANDATE.sh
git commit -m "S816h: the bank authorization covers monthly rent

The \$5 Stripe test's first debit (2026-11-18, invoice MHCIJ1TN-0001) stayed
Incomplete with no mandate, and Stripe ended the subscription. Stripe's
guide (billing/subscriptions/acss-debit) asks the setup to authorize the
mandate for invoices and subscriptions; ours did not. The Checkout setup
now sends mandate_options.default_for [invoice, subscription], and
scheduling rent checks the saved mandate first: an authorization made the
old way asks the tenant to authorize again instead of failing on the
first charge.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
