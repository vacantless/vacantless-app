#!/bin/bash
# S833d: Android shares over ~4.5 MB hit Vercel's 413; a service worker shrinks them on the phone.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "S833d" public/share-sw.js || { echo "STOP: S833d edit missing"; exit 1; }
node --check public/share-sw.js
npx tsc --noEmit -p .
npx tsx scripts/test-s821b-start-here-android-share.ts
node scripts/run-all-tests.mjs
git add public/share-sw.js components/share-sw-register.tsx app/layout.tsx scripts/test-s821b-start-here-android-share.ts COMMIT-S833d-SHRINK-BIG-SHARES.sh
git --no-pager diff --cached --name-only
git commit -m "S833d: shrink big Android shares on the phone

Sharing a large chat picture from Android hit Vercel's 413
FUNCTION_PAYLOAD_TOO_LARGE (about 4.5 MB, KI1746) before Vacantless saw
it. public/share-sw.js, registered on Android only, catches just the share
POST and shrinks a picture over 1.5 MB to 2000 px JPEG first; any error
sends the original. Every other request is untouched.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqDvRRhrhYkyT9VAYj"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
