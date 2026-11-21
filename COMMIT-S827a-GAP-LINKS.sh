#!/bin/bash
# S827a: Rentals list names each rental missing a site, with links.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s827a-gap-links.ts
npx tsx scripts/test-rental-list-view.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add app/dashboard/properties/page.tsx scripts/test-s827a-gap-links.ts COMMIT-S827a-GAP-LINKS.sh
git commit -m "S827a: say which rental is missing which site, and make it clickable

Seen on the Davis account: the Rentals list read '1 rental is missing a
site. Each one is marked on its row.' and 'Need you 1', with nothing to
click and no site named. The only fix on the row was a faint grey
'+ Marketplace' chip that looked switched off.

Now the banner lists each rental and its missing sites as links to the
rental's posting section, the Need you tile jumps to the first rental that
needs you, and the Marketplace chip reads '+ Post to Marketplace' in amber.
Works for every account; no data change.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGmkHg5MoubAxfPMx8c"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
