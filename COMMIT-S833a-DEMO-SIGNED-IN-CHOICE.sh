#!/bin/bash
# S833a: "See a live account" asks a signed-in landlord instead of opening their own account.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'signOut({ scope: "local" })' app/demo/route.ts || { echo "STOP: S833a edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-demo-account.ts
node scripts/run-all-tests.mjs
git add lib/demo-account.ts app/demo/route.ts app/demo/choose/page.tsx scripts/test-demo-account.ts COMMIT-S833a-DEMO-SIGNED-IN-CHOICE.sh
git --no-pager diff --cached --name-only
git commit -m "S833a: See a live account asks a signed-in landlord

The homepage on vacantless.com cannot see an app sign-in, so a signed-in
landlord who pressed See a live account landed in their own account with
no word why. /demo now sends them to /demo/choose: Go to my account, or
Sign out and see the demo (signs out this browser only). Visitors who are
not signed in still go straight into the Lakeview demo.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqDvRRhrhYkyT9VAYj"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
