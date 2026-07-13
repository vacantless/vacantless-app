#!/usr/bin/env bash
# S481c - two fixes on top of 116d5574 (S481b):
#
#  (1) Codex S481b P1 - fileN4ToVault broke normal filing. S481b reserved the slot
#      by writing a fresh docId into notices.filed_document_id BEFORE inserting the
#      documents row, but filed_document_id is an IMMEDIATE FK to documents(id)
#      (mig 0140) -> the reserve update violated the FK, errored, matched 0 rows,
#      and the action redirected 'filed' having created ZERO documents. Fix =
#      create the document FIRST (fill -> upload -> insert), THEN a state-conditional
#      CAS claims the still-null filed_document_id (FK now satisfied). A concurrent
#      double-submit that also created a doc LOSES the CAS and rolls its own orphan
#      (doc row + storage bytes) back, so exactly one vault document is referenced.
#
#  (2) Public /notice 404 (caught in live North Star QA) - the public
#      /notice/[token] + /notice/[token]/official routes read via the SERVICE-ROLE
#      admin client, but mig 0140 granted notices CRUD only to `authenticated`, so
#      service_role SELECT was permission-denied and EVERY served notice 404'd for
#      the tenant. Fix = migration 0142 grants SELECT (read-only) on notices to
#      service_role. ALREADY APPLIED TO PROD via Supabase MCP (2026-07-13); the .sql
#      is committed here for the ledger + other environments. No re-apply needed.
#
# Verified on device: tsc --noEmit 0 errors; test-n4 83/0, test-n4-snapshot 35/0,
#   test-distribution-concierge 60/0. Live-verified in North Star QA AFTER the
#   grant: public /notice/[token] HTML + /official PDF both render the served N4.
#   (fileN4ToVault re-verified live after this deploy.)
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
git rev-parse --is-inside-work-tree >/dev/null

node_modules/.bin/tsx scripts/test-n4.ts                      # expect test-n4: 83/0
node_modules/.bin/tsx scripts/test-n4-snapshot.ts             # expect test-n4-snapshot: 35/0
node_modules/.bin/tsx scripts/test-distribution-concierge.ts  # expect 60/0
npm run build

git add \
  app/dashboard/tenancies/n4-actions.ts \
  supabase/migrations/0142_notices_service_role_select.sql \
  DEPLOY-S481c-FILING-FK-AND-NOTICES-GRANT.sh

git commit -m "S481c: fix N4 filing FK regression (fileN4ToVault - create doc then CAS-claim, loser rolls back orphan) + fix public /notice 404 (grant service_role SELECT on notices, mig 0142 applied to prod). tsc clean; n4 83/0, n4-snapshot 35/0, concierge 60/0"
git push

echo
echo "Pushed. Migration 0142 ALREADY applied to prod (grant only). Verify Vercel READY (KI677)."
git rev-parse --short HEAD
