#!/bin/bash
# S829g: after the helper fills Marketplace, the card says what to do next and saves the link when you come back.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'After you press Post on Facebook' "app/dashboard/properties/[id]/marketplace-row.tsx" || { echo "STOP: S829g edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s829g-marketplace-return.ts
node scripts/run-all-tests.mjs
git add "app/dashboard/properties/[id]/marketplace-row.tsx" components/marketplace-helper-sync.tsx scripts/test-s829g-marketplace-return.ts COMMIT-S829g-MARKETPLACE-RETURN.sh
git commit -m "S829g: Marketplace card says what to do after posting, saves the link on return

After 'Fill Marketplace for me' the card said to paste the link 'in step 4
below', a step that is hidden unless step by step is open, and the new
ad's link was only saved on the next page load. The card now lists the two
steps after Post, keeps them when you come back, and has the paste-link
field right there. Coming back to the tab asks the helper for the new
ad's link, so the card turns live without a reload.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGorzZRkyX89r57Su5V"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
