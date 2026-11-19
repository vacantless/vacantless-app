#!/bin/bash
# S821f: the newcomer viewing-times screen showed for Agile once its last dated time passed. Past dates now count.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s821b-start-here-android-share.ts
node scripts/run-all-tests.mjs
git add app/dashboard/availability/page.tsx scripts/test-s821b-start-here-android-share.ts COMMIT-S821f-VIEWING-TIMES-FIRST-VISIT-FIX.sh
git commit -m "S821f: an account that ever set a viewing time never gets the newcomer screen

S821d showed the one-question screen when an account had no weekly times
and no dated times from today on. Agile opens one date at a time and its
last date was Nov 13, so from 13:34 today Aaliyah saw three preset buttons
and had Group viewings by building and Viewing days by building folded
under More settings. First visit now means the account has never set a
time: past dates count.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGnZ7VZEKhJ4sootXz7"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
