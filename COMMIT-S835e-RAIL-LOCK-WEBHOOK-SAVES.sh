#!/bin/bash
# S835e: REVIEW-S835 findings 7 and 9, and the wider Rotessa NSF check.
# Migration 0327 is NOT applied yet: Claude applies it after this is live.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "S835e" app/api/stripe/webhook/route.ts || { echo "STOP: S835e edit missing"; exit 1; }
test -f supabase/migrations/0327_rail_tables_service_writes.sql || { echo "STOP: migration 0327 missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s835e-rail-lock-webhook-saves.ts
npx tsx scripts/test-s835d-rotessa-nsf.ts
npx tsx scripts/test-stripe-webhook.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0327_rail_tables_service_writes.sql lib/rotessa-nsf.ts \
  app/api/stripe/webhook/route.ts app/dashboard/settings/stripe-connect-actions.ts \
  app/dashboard/settings/rotessa-actions.ts scripts/test-s835e-rail-lock-webhook-saves.ts \
  scripts/test-s835d-rotessa-nsf.ts COMMIT-S835e-RAIL-LOCK-WEBHOOK-SAVES.sh
git --no-pager diff --cached --name-only
git commit -m "S835e: lock the rent link tables, check webhook saves, wider Rotessa NSF

Finding 7: the Stripe and Rotessa link rows are now written with the
service role, only from the Settings actions and only after the rent
check passed for the signed-in account. Migration 0327 (applied after
this is live) then refuses those writes from a signed-in browser, so an
account can not be pointed at another landlord's Stripe account id
through the database. Reads are unchanged.

Finding 9: a failed save in the Stripe webhook (rent status, bank
authorization, plan) now throws, so the event claim is released and
Stripe sends the event again instead of it being marked done.

Rotessa NSF: Rotessa's screens show the reason (NSF) as the status
(Noam's account, 2026-11-23). A status of NSF now counts as failed, and
so does any payment with a failure reason that is not approved, pending
or future.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqgtQ1cMJNk8rr2K6R"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
