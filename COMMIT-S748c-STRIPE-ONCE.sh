#!/bin/bash
# S748c: the Stripe webhook takes each event once. Migration 0270 is applied.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-s748-stripe-event-claim.ts
npx tsx scripts/test-stripe-webhook.ts
echo "== commit"
git add lib/stripe-event-claim.ts app/api/stripe/webhook/route.ts \
  supabase/migrations/0270_stripe_webhook_events.sql \
  scripts/test-s748-stripe-event-claim.ts scripts/test-stripe-webhook.ts \
  COMMIT-S748c-STRIPE-ONCE.sh COMMIT-S748c-MESSAGE.txt
git commit -F COMMIT-S748c-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
