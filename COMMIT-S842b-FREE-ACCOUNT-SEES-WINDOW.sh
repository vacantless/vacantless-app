#!/bin/bash
# S842b: a Free account that starts a site sign-in now sees its window.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q '{access.setup && recent && (' "app/dashboard/site-signin/[channel]/page.tsx" || { echo "STOP: S842b page edit missing"; exit 1; }
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-site-signin.ts
npx tsx scripts/test-posting-addon.ts
node scripts/run-all-tests.mjs
git add "app/dashboard/site-signin/[channel]/page.tsx" scripts/test-site-signin.ts scripts/test-posting-addon.ts \
  COMMIT-S842b-FREE-ACCOUNT-SEES-WINDOW.sh
git --no-pager diff --cached --name-only
git commit -m "S842b: a Free account sees its site sign-in window

Since S832b every account may sign in to the robot sites (access.setup) and
the start button follows that, but the window panel still needed the Posting
add-on (access.allowed). A Free account pressed Sign in, a window started,
and the page showed nothing: no progress, no window. Found on S799 Stranger
Test Rentals (Free) on 2026-11-25. The panel now follows setup, like the
button. The S713 add-on test pins the note on !access.setup instead.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGpssfZ8e8bbSQz9ywk"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
