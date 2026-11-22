#!/bin/bash
# S829a: approving a Kijiji post the robot never built sends it back to the robot.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'shouldReleaseToRobot(pendingItem)' app/dashboard/properties/distribution-actions.ts || { echo "STOP: S829a edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s829-approve-release.ts
npx tsx scripts/test-spend-cap.ts
node scripts/run-all-tests.mjs
git add lib/approve-release.ts app/dashboard/properties/distribution-actions.ts scripts/test-s829-approve-release.ts scripts/test-spend-cap.ts COMMIT-S829a-APPROVE-RELEASE.sh
git commit -m "S829a: approving a Kijiji post the robot never built sends it back to it

Glenrose 2026-11-22: Approve and post saved the approval, but the item
stayed at needs_payment and the robot (which only claims needs_operator)
never picked it up. S784 released a needs_payment item only when no link
was saved; the robot had saved Kijiji's empty post form (p-post-ad.html)
when it stopped on the plan wall, which is not a checkout. A bare post
form now counts as not built (lib/approve-release.ts) and the link is
cleared on release. A real checkout link still waits for the landlord.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGorzZRkyX89r57Su5V"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
