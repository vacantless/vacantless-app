#!/bin/bash
# S830g: a dated line in a rental's ad that has passed is flagged; one tap fixes it and the ads update.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'fixDatedLine' app/dashboard/properties/actions.ts || { echo "STOP: S830g edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s830g-dated-lines.ts
node scripts/run-all-tests.mjs
git add lib/dated-lines.ts app/dashboard/properties/actions.ts "app/dashboard/properties/[id]/page.tsx" app/dashboard/page.tsx \
  scripts/test-s830g-dated-lines.ts COMMIT-S830g-DATED-LINES.sh
git commit -m "S830g: dated lines in an ad expire; one tap fixes them

Noam 2026-11-22: time based details should have expiries. 251 Manitoba's
ads still said 'No showings before October 26, 2026' a month later. A
sentence in a live rental's description whose calendar date has passed now
shows on the rental page and as a card on Today. One tap fixes it: an
'Available ...' line becomes 'Available now.', any other line is cut, and
the change reaches the ads the same way a saved edit does (Kijiji edited in
place, free robot sites re-posted, Facebook Page post edited). Nothing is
cut without the landlord's tap. Only a line that is really past its date
can be fixed this way.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGo6sCsrGeBAq56QJdq"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
