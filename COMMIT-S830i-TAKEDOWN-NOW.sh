#!/bin/bash
# S830i: queuing a Kijiji edit or a Kijiji/Zumper takedown wakes the worker at once. Run AFTER COMMIT-S830w in vacantless-worker.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'triggerTakedownNow' lib/robot-edit.ts || { echo "STOP: S830i edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s830i-takedown-now.ts
node scripts/run-all-tests.mjs
git add lib/post-now.ts lib/robot-edit.ts lib/robot-takedown.ts scripts/test-s830i-takedown-now.ts COMMIT-S830i-TAKEDOWN-NOW.sh
git commit -m "S830i: an edit or takedown on Kijiji or Zumper starts the robot at once

The Manitoba edit sat queued for over an hour because GitHub ran the
takedown-sites schedule only about 3 times a day. queueRobotEdits and
queueRobotTakedowns now send repository_dispatch takedown-now (the same
token as post-now; no token, no call). Pairs with worker S830w.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGo6sCsrGeBAq56QJdq"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
