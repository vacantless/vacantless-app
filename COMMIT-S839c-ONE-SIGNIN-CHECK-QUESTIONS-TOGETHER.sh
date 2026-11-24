#!/bin/bash
# S839c (REVIEW-S839 steps D and E): one sign-in and account lookup per page
# render, and the independent database questions on Today, the rental page and
# the tenancy page start together instead of one after another.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "export const getCurrentOrg = perRequest(loadCurrentOrg);" lib/org.ts || { echo "STOP: S839c org edit missing"; exit 1; }
grep -q "leadsEarly = early(" "app/dashboard/properties/[id]/page.tsx" || { echo "STOP: S839c rental edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s839c-early-request-cache.ts
node scripts/run-all-tests.mjs
git add lib/early.ts lib/request-cache.ts lib/supabase/server.ts lib/org.ts lib/membership.ts \
  app/dashboard/layout.tsx app/dashboard/page.tsx \
  "app/dashboard/properties/[id]/page.tsx" "app/dashboard/tenancies/[id]/page.tsx" \
  scripts/test-s839c-early-request-cache.ts COMMIT-S839c-ONE-SIGNIN-CHECK-QUESTIONS-TOGETHER.sh
git --no-pager diff --cached --name-only
git commit -m "S839c: one sign-in check per page, database questions run together

REVIEW-S839 steps D and E. Measured after S839a: Today 1.7 to 2.2 s, one
rental 2.3 to 3.3 s, one tenancy 2.6 to 2.7 s, with the server already
beside the database. The time is in the number of round trips.
- lib/request-cache.ts perRequest(): the signed-in user, the current account,
  the account list and the role are looked up once per page render (React
  cache). Server actions and routes are outside a render and still read
  fresh every call. The user is still checked with the auth server.
- lib/early.ts early(): questions that do not depend on each other start
  together and are awaited where they were. 10 on Today, 18 on the rental
  page, 21 on the tenancy page. No query, filter or order of logic changed.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrF59iM2qiBS4Uh8MK"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
