#!/bin/bash
# S824j: "Also send to" on Every message we send, plus phone links.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s824j-extra-recipients.ts
npx tsx scripts/test-s824e-message-catalog.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0317_message_extra_recipients.sql lib/message-recipients-server.ts lib/message-catalog.ts \
  app/api/cron/posted-results-email/route.ts app/api/cron/signin-lost/route.ts lib/site-mail-pass-server.ts \
  lib/incident-notify-server.ts app/dashboard/automations/every-message/actions.ts \
  app/dashboard/automations/every-message/page.tsx scripts/test-s824j-extra-recipients.ts COMMIT-S824j-ALSO-SEND-TO.sh
git commit -m "S824j: Also send to on the owner alerts, phone links on Every message

Four alerts went only to the account owners: where your ads are live, a
site signed you out, rental-site account emails, and a tenant's report.
Each row on Every message we send now has an Also send to box (up to 20
addresses, checked like the other recipient boxes). The owners still get
it; the added people get it too. Kept in message_extra_recipients (0317).
A closed account sends site emails to no added address.
The arrival and emergency rows link to where those phones are changed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGnzykYaE5HoHtPVQ2C"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
