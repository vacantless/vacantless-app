#!/bin/bash
# S833e: Android share builds the reply in the renter's own account (Davis renter while signed in to Agile).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "S833e" app/dashboard/replies/shared/route.ts || { echo "STOP: S833e edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s821b-start-here-android-share.ts
node scripts/run-all-tests.mjs
git add app/dashboard/replies/shared/route.ts scripts/test-s821b-start-here-android-share.ts COMMIT-S833e-ANDROID-REPLY-OWN-ACCOUNT.sh
git --no-pager diff --cached --name-only
git commit -m "S833e: Android share reply comes from the renter's own account

Koby (50 Glenrose B, Davis) shared while signed in to Agile was found but
got no reply: the Android route loaded reply cards and the phone from the
signed-in account. It now uses the account the renter is in, like the
iPhone path, and passes the reader's topic.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqDvRRhrhYkyT9VAYj"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
