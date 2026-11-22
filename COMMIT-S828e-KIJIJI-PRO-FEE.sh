#!/bin/bash
# S828e: a Professional rental pays the Kijiji fee on every ad. S828d was wrong.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s828-fixes.ts
npx tsx scripts/test-distribution-channels.ts
npx tsx scripts/test-plain-language.ts
git add lib/distribution-channels.ts "app/dashboard/properties/[id]/publish-everywhere.tsx" scripts/test-s828-fixes.ts COMMIT-S828e-KIJIJI-PRO-FEE.sh
git commit -m "S828e: a Professional rental pays the Kijiji fee on every ad

S828d said a Professional rental gets one free basic ad. The robot's
screenshot on Glenrose (2026-11-22) shows For Rent By Professional costs
\$29.95 per unit for 31 days; the \$0 Lite card only removes the package
price, and the Total Price stays \$29.95. The free ad is for Owner only.
The row now says every ad costs \$33.84, the first one included.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrErkpMczrKTEhuh7Z"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
