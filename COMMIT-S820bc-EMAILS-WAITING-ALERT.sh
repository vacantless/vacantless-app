#!/bin/bash
# S820b: application, credit check and offer emails read right. S820c: renters waiting, no times open.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s820b-application-emails.ts
npx tsx scripts/test-s820c-waiting-alert.ts
npx tsx scripts/test-availability-tripwire.ts
npx tsx scripts/test-leasing-snapshot.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/email.ts lib/rental-application-server.ts app/dashboard/leads/actions.ts \
  lib/availability-tripwire.ts lib/notifications.ts app/api/cron/availability-tripwire/route.ts \
  lib/leasing-snapshot.ts app/api/cron/leasing-snapshot/route.ts \
  scripts/test-s820b-application-emails.ts scripts/test-s820c-waiting-alert.ts COMMIT-S820bc-EMAILS-WAITING-ALERT.sh
git commit -m "S820b+c: clearer application emails; a daily nudge while renters wait

S820b, from reading the Lakeview test emails: the offer email now says what
happens next (sign or decline on the page, the other applicant signs too,
then the landlord is in touch about the lease), shows any conditions, has a
Questions line and the same footer as the others. A co-applicant's
application email says who added them instead of \"you inquired\". The
application, credit check and offer emails carry their own plain-text copy,
so previews show \$1,500, not \$1500.

S820c: Agile had no open viewing times and 20 renters waiting, and the
\"no viewing times\" alert had gone quiet for the week. While new renters
keep arriving with nothing open, it now comes back once a day after 8 am
and names them. The daily email marks renters saved from a chat (no email
or phone) as \"Facebook Marketplace chat, reply there\".

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqpaWNL7tNvrXegHrw"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
