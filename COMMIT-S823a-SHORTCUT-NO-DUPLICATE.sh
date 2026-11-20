#!/bin/bash
# S823a: a renter saved from the phone share menu no longer becomes a second renter.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-chat-leads.ts
npx tsx scripts/test-s816l-send-shortcut.ts
node scripts/run-all-tests.mjs
git add lib/chat-leads.ts scripts/test-chat-leads.ts COMMIT-S823a-SHORTCUT-NO-DUPLICATE.sh
git commit -m "S823a: phone share renters merge with the same renter's booking

Send to Vacantless made a second renter three times on Agile's Unit 9.
Shnya: saved from the iPhone at 8:27, booked with the link at 11:13; the
booking's merge only knew the helper and Quick replies notes, so the
Shortcut row stayed. Chidi: booked as 'Victor chidi', then saved from the
phone as 'Chidi'; names matched on the first name only.

A phone share renter with no email or phone is now a chat renter (its
'share menu (chat screenshot)' note, iPhone and Android), so a later
booking takes its place and keeps the renter's question in the dated note.
A one-word name also matches a full name's last name ('Chidi' = 'Victor
Chidi'). The two Unit 9 pairs were merged by hand.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGngsKqF4sZh6eWxsjC"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
