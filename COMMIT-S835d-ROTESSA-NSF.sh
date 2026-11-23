#!/bin/bash
# S835d: failed Rotessa rent debits are read from Rotessa's transaction report
# and become NSF charges, an expense and an email. Migration 0326 is applied.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
test -f lib/rotessa-nsf-server.ts || { echo "STOP: lib/rotessa-nsf-server.ts missing"; exit 1; }
test -f supabase/migrations/0326_nsf_charge_external_ref.sql || { echo "STOP: migration 0326 missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s835d-rotessa-nsf.ts
npx tsx scripts/test-s835c-nsf-charges.ts
npx tsx scripts/test-s824e-message-catalog.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0326_nsf_charge_external_ref.sql lib/rotessa-nsf.ts lib/rotessa-nsf-server.ts \
  lib/rent-failed.ts lib/rent-failed-notify.ts lib/message-catalog.ts \
  app/api/cron/rent-stop/route.ts components/tenancy-nsf-charges.tsx \
  scripts/test-s835d-rotessa-nsf.ts COMMIT-S835d-ROTESSA-NSF.sh
git --no-pager diff --cached --name-only
git commit -m "S835d: Rotessa NSFs become NSF charges, an expense and an email

Rotessa sends Vacantless nothing when a rent debit fails. The rent sweep
now reads each connected account's transaction report three times a day
(8 am, 2 pm, 8 pm Toronto; the last 14 days) for tenancies linked to a
Rotessa customer. A declined or charged-back payment adds an NSF charge
on the tenancy (\$30, Rotessa's fee, editable), records the \$30 as an
expense on the rental, and emails the owners. One per transaction
(external_ref is unique), so reading again adds nothing. Reads only:
nothing is changed at Rotessa.

Migration 0326 (external_ref on tenancy_nsf_charges) is applied.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqgtQ1cMJNk8rr2K6R"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
