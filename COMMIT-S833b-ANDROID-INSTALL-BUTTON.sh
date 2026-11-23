#!/bin/bash
# S833b: one-tap "Install Vacantless on this phone" button on Android (Quick replies).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "beforeinstallprompt" components/install-app-button.tsx || { echo "STOP: S833b edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s821b-start-here-android-share.ts
node scripts/run-all-tests.mjs
git add components/install-app-button.tsx lib/share-target.ts app/dashboard/replies/send-shortcut-card.tsx scripts/test-s821b-start-here-android-share.ts COMMIT-S833b-ANDROID-INSTALL-BUTTON.sh
git --no-pager diff --cached --name-only
git commit -m "S833b: Install Vacantless button on Android

Installing the app (so it shows in the Share menu) meant finding Chrome's
three-dots menu. Quick replies now shows a green Install Vacantless on
this phone button under the Android steps when Chrome offers the install;
once installed it says the app is in the Share menu. Nothing shows on
iPhone or a computer. Android share proven on a real phone 2026-11-23
(Kym saved in Agile from a Marketplace screenshot).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqDvRRhrhYkyT9VAYj"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
