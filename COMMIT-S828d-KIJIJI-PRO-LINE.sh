#!/bin/bash
# S828d: the Kijiji row line for a Professional rental was wrong (there is one free ad).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s828-fixes.ts
npx tsx scripts/test-distribution-channels.ts
npx tsx scripts/test-plain-language.ts
git add lib/distribution-channels.ts "app/dashboard/properties/[id]/publish-everywhere.tsx" scripts/test-s828-fixes.ts COMMIT-S828d-KIJIJI-PRO-LINE.sh
git commit -m "S828d: a Professional rental still gets one free Kijiji ad

S828a told landlords \"Kijiji has no free ad for a real estate
professional\". On the Davis account (2026-11-22) Kijiji offered a \$0 basic
ad (10 photos) to a Professional rental, priced only from the second
listing. The row now says one free basic ad per account, then \$33.84 each
waiting at Kijiji's checkout, in the normal grey (not a warning).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrErkpMczrKTEhuh7Z"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
