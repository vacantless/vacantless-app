#!/bin/bash
# S824h: two wording fixes read on Agile's pages.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s824e-message-catalog.ts
npx tsx scripts/test-plain-language.ts
git add app/dashboard/availability/page.tsx app/dashboard/automations/every-message/page.tsx scripts/test-s824e-message-catalog.ts COMMIT-S824h-WORDING.sh
git commit -m "S824h: say only what will happen

Read on Agile's pages after S824g:
- Set viewing times: renters hear when you open times at their building,
  by email and text. It no longer reads as every renter, every time.
- Every message we send: the renter's week says with your arrival note
  only when a rental has one. Agile has none yet.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGq4W8hFu15eRRP3WoB"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
