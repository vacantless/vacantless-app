#!/bin/bash
# S825a: the phone setup page no longer crashes after the one tap on iPhone.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s824d-phone-setup.ts
node scripts/run-all-tests.mjs
git add "app/phone/[token]/page.tsx" "app/phone/[token]/phone-setup.tsx" scripts/test-s824d-phone-setup.ts COMMIT-S825a-PHONE-SETUP-NO-CRASH.sh
git commit -m "S825a: phone setup page keeps its panel and stops crashing

First real use (Lakeview, iPhone, 2026-11-20 10:39): the tap signed the
phone in and made the key, then the page showed Something went wrong
(Load failed). The sign-in refreshes the page; the refreshed page saw the
code as used and swapped the setup panel out, and the jump to the Shortcut
file left mid-load. Now the page always renders the same setup piece (so
the key copied panel stays) and opens the Shortcut after a short pause.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGnzykYaE5HoHtPVQ2C"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
