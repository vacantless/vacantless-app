#!/bin/bash
# S825b: Offer times card shows a name over each time box.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-viewing-offers.ts
node scripts/run-all-tests.mjs
git add "app/dashboard/leads/[id]/page.tsx" scripts/test-viewing-offers.ts COMMIT-S825b-OFFER-TIME-LABELS.sh
git commit -m "S825b: name each time box on Offer times to this renter

Seen by eye on an Agile renter page: the three boxes showed only
yyyy-mm-dd, --:-- -- with their names hidden for screen readers. Each box
now has a visible name: First time, Second time if you have one, Third
time if you have one.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGnzykYaE5HoHtPVQ2C"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
