#!/bin/bash
# S835h: the homepage, shorter, with nothing removed. No migration.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
test -f scripts/test-s835h-homepage-shorter.ts || { echo "STOP: scripts/test-s835h-homepage-shorter.ts missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s835h-homepage-shorter.ts
npx tsx scripts/test-s832-vendor-costs.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add app/page.tsx components/savings-band.tsx components/vendor-cost-table.tsx \
  scripts/test-s835h-homepage-shorter.ts COMMIT-S835h-HOMEPAGE-SHORTER.sh
git --no-pager diff --cached --name-only
git commit -m "S835h: the homepage, shorter, with nothing removed

Noam: 15 screens long is tough; shorten it without losing anything
important. Every line stays in the page; folds are plain details.

- Pricing: Every paid plan includes shows its five group names, and the
  full list opens from one line. Plan prices stay open. Posting and
  Rent collection sit side by side on a wide screen.
- Then it runs the rest: each card shows three points, the rest under
  Show N more. A card with one extra line stays whole. Turnovers leads
  with the link, the taps, and hearing when a unit stalls.
- The paperwork, filled in is now the first card in Little things, with
  the same three items, links and #paperwork anchor.
- Read on the live S835g page: the band is the page's width, about
  comes before the number, and table prices no longer wrap.
Untouched: hero, What you stop doing, the band, the video, the proof,
Less typing, Set up in one sitting, founder, questions, closing.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqgtQ1cMJNk8rr2K6R"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
