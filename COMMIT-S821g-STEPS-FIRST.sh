#!/bin/bash
# S821g: Getting started shows the steps first; the welcome email says one site is enough.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s821b-start-here-android-share.ts
npx tsx scripts/test-onboarding-emails.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add "app/dashboard/(wizard)/getting-started/page.tsx" lib/onboarding-emails.ts scripts/test-s821b-start-here-android-share.ts COMMIT-S821g-STEPS-FIRST.sh
git commit -m "S821g: Getting started shows the steps first

A fresh sign-up (S821 Newcomer Test Rentals) opened Getting started with
four boxes above step 1: languages, videos, progress and the helper invite.
Add rental was nearly off the first screen. Progress stays on top; the
other three now sit below the steps. The welcome email's step 3 listed all
five sites; it now says one site is enough to begin.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGnZ7VZEKhJ4sootXz7"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
