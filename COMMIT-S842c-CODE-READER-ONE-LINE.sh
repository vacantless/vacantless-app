#!/bin/bash
# S842c: read Rentals.ca's sign-in code from its real one-paragraph text part.
# Run AFTER COMMIT-S842b-FREE-ACCOUNT-SEES-WINDOW.sh.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'S842c: try the text part, then the html' lib/site-mail-pass.ts || { echo "STOP: S842c reader edit missing"; exit 1; }
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s841g-code-early-window.ts
node scripts/run-all-tests.mjs
git add lib/site-mail-pass.ts scripts/test-s841g-code-early-window.ts COMMIT-S842c-CODE-READER-ONE-LINE.sh
git --no-pager diff --cached --name-only
git commit -m "S842c: read Rentals.ca's sign-in code from the real email

S841g read the code only when it sat on a line of its own, from a sample
copied out of Gmail's display. Rentals.ca's real text part is one paragraph
('...when prompted on the page. 117704 Please note...'), and the reader
reads the text part first, so on 2026-11-25 (S799 Stranger Test Rentals)
the code email arrived at 09:56:16 while the window showed the code box
(worker logged code_on_landlord_tab) and nothing was typed. Now: the first
six-digit word after 'one-time passcode', from the text part, then the html.
Test uses the real decoded text part.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGpssfZ8e8bbSQz9ywk"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
