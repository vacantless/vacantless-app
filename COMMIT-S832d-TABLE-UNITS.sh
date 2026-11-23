#!/bin/bash
# S832d: the Canadian-dollar price on each table line names what it is per.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'per: "an hour"' lib/vendor-costs.ts || { echo "STOP: S832d edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s832-vendor-costs.ts
git add lib/vendor-costs.ts scripts/test-s832-vendor-costs.ts COMMIT-S832d-TABLE-UNITS.sh
git --no-pager diff --cached --name-only
git commit -m "S832d: vendor table prices name their unit

The bold Canadian-dollar price read \"about CA\$14 to CA\$29\" for posting help
with no unit; it is per hour. Each line now says a month, an hour, a
notice or a photo.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGoZLAxBr3cq3Dgcj6r"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
