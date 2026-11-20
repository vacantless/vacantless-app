#!/bin/bash
# S824e: "Every message we send", one page for every email, text and call message, with a test that keeps it complete.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s824e-message-catalog.ts
npx tsx scripts/test-plain-language.ts --update-baseline
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/message-catalog.ts app/dashboard/automations/every-message/page.tsx app/dashboard/automations/every-message/actions.ts app/dashboard/automations/page.tsx scripts/test-s824e-message-catalog.ts scripts/test-plain-language.ts scripts/plain-language-baseline.json COMMIT-S824e-EVERY-MESSAGE.sh
git commit -m "S824e: every message we send, on one page

Messages and reminders listed 58 alert emails. Renter messages, texts,
timing and the account emails were not on it.

New page, Messages and reminders, See every message we send:
- Grouped by who gets it: renters, tenants, showing agents and crew,
  trades, you, your Vacantless account, Vacantless staff, other services.
- Each row says when it goes out, by email, text or call, and shows if
  it is on, off, sent when you press a button, or drafted for you.
- Plain switches turn on or off right there: renter follow-ups, viewing
  feedback, the pick-a-new-time reminder, the viewing times alerts and
  the yearly reminders. Alert emails link to their card to edit wording.
- A renter's week at the top, from first message to the feedback email.

lib/message-catalog.ts is the list. scripts/test-s824e-message-catalog.ts
fails when a send in the code is not on it: every email sender, every
file that sends a text, every direct email and every call answer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGq4W8hFu15eRRP3WoB"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
