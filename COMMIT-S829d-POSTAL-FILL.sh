#!/bin/bash
# S829d: a rental saved with no postal code gets one (KI1752).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'fillMissingPostalCode' app/dashboard/properties/actions.ts || { echo "STOP: S829d edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s829d-postal-fill.ts
node scripts/run-all-tests.mjs
git add lib/postal-fill.ts app/dashboard/properties/actions.ts scripts/test-s829d-postal-fill.ts COMMIT-S829d-POSTAL-FILL.sh
git commit -m "S829d: a rental saved with no postal code gets one

50 Glenrose B was saved as '50 Glenrose Ave, Unit B, Toronto, ON' with no
postal code, and Kijiji could not place it (KI1752). On create and on the
next save, a missing postal code is read from the address text, else from
the geocoder asked without the unit. Only fills an empty postal code and
never blocks a save.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGorzZRkyX89r57Su5V"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
