#!/bin/bash
# S742i: one-tap viewing time presets under "Renters can't book a viewing" on Today.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
for t in viewing-presets dashboard-today availability-reopen plain-language; do
  npx tsx scripts/test-$t.ts
done
echo "== commit"
git add lib/viewing-presets.ts scripts/test-viewing-presets.ts app/dashboard/availability/actions.ts \
  app/dashboard/today-lane.tsx app/dashboard/page.tsx \
  COMMIT-S742i-ONE-TAP-VIEWING-TIMES.sh COMMIT-S742i-MESSAGE.txt
git commit -F COMMIT-S742i-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
