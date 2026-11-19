#!/bin/bash
# S821e: fixes from four translated walks: "times" not "windows", names left alone, a language line.
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
git add app/dashboard/availability/page.tsx components/ui.tsx "app/dashboard/properties/[id]/page.tsx" \
  "app/dashboard/leads/[id]/page.tsx" app/dashboard/properties/page.tsx app/dashboard/leads/triage-queue.tsx \
  lib/translate-hint.ts lib/onboarding-emails.ts "app/dashboard/(wizard)/getting-started/page.tsx" \
  scripts/test-s821b-start-here-android-share.ts COMMIT-S821e-TRANSLATED-WALK-FIXES.sh
git commit -m "S821e: fixes from four translated walks

The app was read through Chrome's translator in Punjabi, Hindi, Arabic and
Chinese on the S799 test account. Nothing crashed and Arabic laid out right
to left, but three things went wrong. Viewing 'windows' came out as the
computer kind, so Set viewing times now says times. A rental's address and a
renter's name could be translated, so the rental page, the renter page, the
Rentals list and the renter queue mark them not to translate. And a fresh
page load fell back to English, so Getting started and the welcome email now
carry one line, with the language names in their own script, saying how to
turn on Always translate. The welcome email also names the Android share.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGnZ7VZEKhJ4sootXz7"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
