#!/bin/bash
# S837b: Watch a lease follows S837a (no orphan unit on a failed save). No migration.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "S837b" lib/watch-lease.ts || { echo "STOP: S837b edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s837a-tenancy-save.ts
npx tsx scripts/test-watch-lease.ts
node scripts/run-all-tests.mjs
git add app/dashboard/tenancies/actions.ts lib/watch-lease.ts \
  scripts/test-s837a-tenancy-save.ts COMMIT-S837b-WATCH-LEASE-SAVE.sh
git --no-pager diff --cached --name-only
git commit -m "S837b: Watch a lease leaves no orphan unit on a failed save

Found on the second pass over S837a: watchLease makes a private unit and
then the tenancy, the same pattern createTenancy had.

- If the tenancy does not save, the unit made a moment ago is deleted and
  the form says the lease did not save and nothing was kept, instead of
  dropping the landlord on the Tenants list.
- The tenant insert is checked; if it fails the tenancy page says the
  tenancy saved but the tenant did not.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGq62AeiRudKPY5nbjt"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
