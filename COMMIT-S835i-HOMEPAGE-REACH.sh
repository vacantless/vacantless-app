#!/bin/bash
# S835i: record how far down the homepage each visitor gets. Migration 0328
# (a new table, nothing dropped) is already applied.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
test -f app/api/funnel/seen/route.ts || { echo "STOP: app/api/funnel/seen/route.ts missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-stranger-funnel.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add app/page.tsx app/api/funnel/seen/route.ts components/visit-beacon.tsx \
  lib/stranger-funnel.ts app/dashboard/admin/stranger-funnel-section.tsx \
  supabase/migrations/0328_funnel_sections.sql scripts/test-stranger-funnel.ts \
  COMMIT-S835i-HOMEPAGE-REACH.sh
git --no-pager diff --cached --name-only
git commit -m "S835i: record how far down the homepage each visitor gets

After S835h shortened the page by 8 percent, the open question was
whether length loses anyone. Nothing recorded it, so this does, before
the layout changes again.

- The homepage tells the server each section a visitor brings into
  view, in small batches and once more when the page is left. Same
  rules as the visit count: a random browser id, no names, bots and
  signed-in visitors left out, and it can never slow or break the page.
- Migration 0328: funnel_sections, one row per browser, section and
  day. Service key only.
- The admin console shows how many browsers reached each section. A
  browser counts at its furthest section, so a jump link or a fast
  scroll does not undercount the sections above it.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqgtQ1cMJNk8rr2K6R"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
