#!/bin/bash
# S816j: Stripe bank link works with default_for; rent increase no longer opens on every page.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s816h-pad-mandate.ts
npx tsx scripts/test-stripe-connect.ts
npx tsx scripts/test-tenancy-section.ts
git add lib/stripe-connect.ts app/dashboard/tenancies/stripe-rent-actions.ts "app/dashboard/tenancies/[id]/page.tsx" scripts/test-s816h-pad-mandate.ts scripts/test-stripe-connect.ts COMMIT-S816j-PAD-PARAMS-RENT-OPEN.sh
git commit -m "S816j: bank link works with default_for; rent increase stays closed on new leases

Stripe refused the S816h setup session (400): payment_schedule and
interval_description are not allowed with mandate_options.default_for.
Both removed; the subscription sets the monthly schedule. The setup error
is now logged instead of swallowed.

Noam 2026-11-18: 'why is rent increase always expanded?' Confirm rent
opened itself on every tenancy without a confirmed rent, even a lease that
started this week. It now opens itself only when the lease is over ten
months old; otherwise it stays closed with its chip.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
