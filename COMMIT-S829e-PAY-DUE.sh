#!/bin/bash
# S829e: a paid ad waiting at checkout reads "Pay for Kijiji ad", never "Post to Kijiji".
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'payDueHere' app/dashboard/properties/actions.ts || { echo "STOP: S829e edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s829e-pay-due.ts
node scripts/run-all-tests.mjs
git add lib/rental-list-view.ts app/dashboard/properties/page.tsx app/dashboard/properties/actions.ts scripts/test-s829e-pay-due.ts scripts/test-s828-fixes.ts COMMIT-S829e-PAY-DUE.sh
git commit -m "S829e: a paid ad waiting at checkout says Pay, not Post

With the Kijiji ad built and waiting for payment, the Rentals list still
offered 'Post to Kijiji'. Pressing it would have queued a second ad. The
row now shows 'Pay for Kijiji ad' and opens the pay step, the gap banner
leaves that site out, and the post action refuses a site already at
checkout or just paid.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGorzZRkyX89r57Su5V"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
