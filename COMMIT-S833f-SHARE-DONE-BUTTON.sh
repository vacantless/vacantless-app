#!/bin/bash
# S833f: the Android share screen ends with a Done button that closes it.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "S833f" lib/share-target.ts || { echo "STOP: S833f edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s821b-start-here-android-share.ts
node scripts/run-all-tests.mjs
git add lib/share-target.ts scripts/test-s821b-start-here-android-share.ts COMMIT-S833f-SHARE-DONE-BUTTON.sh
git --no-pager diff --cached --name-only
git commit -m "S833f: Done button on the Android share screen

The screen said Done at the top but had no way out. The heading now says
Saved, and a green Done button at the bottom closes the screen (back to
the chat); if the phone keeps it open it goes to the app home so the next
share starts clean. After Copy it says: tap Done, then paste it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqDvRRhrhYkyT9VAYj"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
