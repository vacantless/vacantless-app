#!/bin/bash
# S830d: Getting started "Set up your phone and computer" with "Have someone set it up for me".
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'helpsetup' lib/onboarding-wizard.ts || { echo "STOP: S830d edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s830d-set-up-my-tools.ts
node scripts/run-all-tests.mjs
git add lib/onboarding-wizard.ts "app/dashboard/(wizard)/getting-started/page.tsx" app/dashboard/settings/page.tsx \
  app/dashboard/settings/team-section.tsx app/dashboard/settings/team-actions.ts lib/email.ts lib/message-catalog.ts \
  scripts/test-s830d-set-up-my-tools.ts COMMIT-S830d-SET-UP-MY-TOOLS.sh
git commit -m "S830d: Set up your phone and computer, or have someone set it up for you

PLAN-S829 item 2b. Noam found the phone setup hard himself; older and
ESL landlords need it easier. The Getting started phone step now covers
both tools (Send to Vacantless on the phone, the Chrome helper on a
computer, and says the helper does not run on a phone) and has a second
button, Have someone set it up for me. It opens Settings, Team with a
note; the invite email then lists the two tools and how to set them up.
Free accounts already have one helper seat (S821c).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGo6sCsrGeBAq56QJdq"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
