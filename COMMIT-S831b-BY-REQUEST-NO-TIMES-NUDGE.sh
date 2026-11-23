#!/bin/bash
# S831b: an account that books each viewing itself is never told to add viewing times.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'viewingsByRequest?: boolean' lib/unit-journey.ts || { echo "STOP: S831b edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-unit-journey.ts
node scripts/run-all-tests.mjs
git add lib/unit-journey.ts "app/dashboard/properties/[id]/page.tsx" app/dashboard/properties/page.tsx scripts/test-unit-journey.ts COMMIT-S831b-BY-REQUEST-NO-TIMES-NUDGE.sh
git diff --cached --name-only
git commit -m "S831b: no add-viewing-times nudge for accounts that book viewings themselves

Glenrose (Davis, I book each viewing myself) read Next: No viewing times
are open, so renters cannot book. Add viewing times. The rental's journey
line and the How this rental is doing card now skip the open-times check
when viewings_by_request is on (S828c), on the rental page and Rentals list.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqrYaTbtLw6Gm8kuG1"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
