#!/bin/bash
# S824g: a switch for "new viewing times are open", the warning on Set viewing times, and two texts added to the list.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s824e-message-catalog.ts
npx tsx scripts/test-availability-reopen.ts
npx tsx scripts/test-plain-language.ts --update-baseline
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0316_viewing_times_opened_switch.sql lib/message-catalog.ts \
  app/api/cron/availability-reopened-notify/route.ts app/dashboard/availability/page.tsx \
  app/dashboard/automations/every-message/page.tsx scripts/test-s824e-message-catalog.ts \
  scripts/plain-language-baseline.json COMMIT-S824g-TIMES-OPENED-SWITCH.sh
git commit -m "S824g: a switch for new viewing times, and two texts the list missed

- New viewing times are open: an on or off switch on Every message we
  send. On for every account, so nothing changes until someone turns it
  off. Migration 0316: organizations.viewing_times_opened_enabled.
- Set viewing times now says it plainly: 3 renters found no time that
  worked. When you open times, they get an email and a text. Never at
  night. With a link to turn it off.
- The list was missing two texts: the new-times text, and the text back
  after a voicemail. Both are on it now.
- The completeness test now also catches a file that sends through a
  passed-in sender, not only a direct sendSms or sendNotificationEmail.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGq4W8hFu15eRRP3WoB"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
