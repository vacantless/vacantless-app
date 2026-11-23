#!/bin/bash
# S830h: "Have someone set it up for me" only for someone who may invite.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'canInvite && !isComplete' "app/dashboard/(wizard)/getting-started/page.tsx" || { echo "STOP: S830h edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s830d-set-up-my-tools.ts
node scripts/run-all-tests.mjs
git add "app/dashboard/(wizard)/getting-started/page.tsx" scripts/test-s830d-set-up-my-tools.ts COMMIT-S830h-HELPER-BUTTON-OWNERS.sh
git commit -m "S830h: Have someone set it up for me shows only to someone who may invite

Found on the phone-width walk: signed in as a Teammate on Davis, the
button led to Settings, Team with no invite box (Teammates cannot invite).
The button now needs the manage_team permission and a plan with a seat.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGo6sCsrGeBAq56QJdq"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
