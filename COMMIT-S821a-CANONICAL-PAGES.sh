#!/bin/bash
# S821a: every public marketing page names its www.vacantless.com address (Search Console duplicate pages).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-canonical-host.ts
node scripts/run-all-tests.mjs
git add app/page.tsx app/about/page.tsx app/compare/showinghero/page.tsx app/data-deletion/page.tsx \
  app/how-to/page.tsx app/legal/trade-terms/page.tsx app/privacy/page.tsx app/realtors/page.tsx \
  app/terms/page.tsx scripts/test-canonical-host.ts COMMIT-S821a-CANONICAL-PAGES.sh
git commit -m "S821a: public pages name their www address for Google

Search Console found the homepage on app.vacantless.com and /about on two
hosts with no canonical tag, so Google picked one copy itself (Duplicate
without user-selected canonical). The homepage, About, the ShowingHero
comparison, how-to, realtors, privacy, terms, data deletion and trade terms
now name https://www.vacantless.com/<path>, as /tools and /ask already did.
test-canonical-host checks all eleven.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGnZ7VZEKhJ4sootXz7"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
