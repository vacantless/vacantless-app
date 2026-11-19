#!/bin/bash
# S821d: first visits to Set viewing times and Connect your rental sites are one question each.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s821b-start-here-android-share.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add app/dashboard/layout.tsx app/dashboard/availability/page.tsx app/dashboard/availability/actions.ts app/dashboard/sites/page.tsx \
  app/dashboard/sites/sites-rows.tsx lib/sites-setup.ts scripts/test-s821b-start-here-android-share.ts \
  COMMIT-S821d-FIRST-VISIT-TIMES-SITES.sh
git commit -m "S821d: first visits to viewing times and sites are one question each

A stranger walk on S799 found both pages ran about 500 words before the
first button. Set viewing times now opens, for an account with no times,
with When can you show the rental? and three one-tap choices (the presets
Today already had); the rest waits under More settings. Connect your rental
sites, for an account with nothing connected, says Pick one site to begin,
each site row opens its own page where Make my account sits beside sign-in,
the walk-all-three button waits, and the price line moves below the rows.
Accounts that already have times or a site see the pages as before.

A walk with Chrome's translator set to Punjabi found no crash, but the
brand read as the word for empty and the account name was translated; both
are now marked not to translate.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGnZ7VZEKhJ4sootXz7"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
