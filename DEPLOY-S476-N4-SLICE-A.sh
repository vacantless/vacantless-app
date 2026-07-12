#!/usr/bin/env bash
# S476 - N4 notice-library, Slice A (data + pure logic). The migration 0140 is
# ALREADY applied to prod via MCP + verified (15 cols, RLS on, 1 org policy, 4
# indexes, N-type CHECK). This commit just lands the .sql + pure logic + tests in
# the repo so the ledger matches prod. NO app behaviour changes yet (nothing
# imports lib/n4.ts), so this is safe; Slice B/C wire it to a route.
#
# Files:
#   supabase/migrations/0140_notices.sql  - generic notices(...) table (N4 first),
#       org-scoped RLS (organization_id IN user_org_ids()); immutable-snapshot +
#       service_token shape generalized from the n1_* columns (0132/0134).
#   lib/n4.ts        - pure: deriveN4TerminationDate (RTA s.59 min notice: 14d
#       monthly/yearly, 7d daily/weekly), deriveN4Arrears (rent x rent_payments
#       ledger; unassigned/out-of-window payments SURFACED not applied so it never
#       overstates arrears -> void), resolveN4OwingCents (operator override wins).
#   scripts/test-n4.ts - 43/0 (dates incl leap/year roll, period enumeration,
#       partial/overpaid/fully-paid arrears, override rules).
#
# Gates (device this session): tsc --noEmit clean (EXIT 0); eslint lib/n4.ts +
#   scripts/test-n4.ts clean; test transpiled to CJS + run via node = 43/0.
#   Mac gate below re-runs the test via tsx + the real next build.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
git rev-parse --is-inside-work-tree >/dev/null

node_modules/.bin/tsx scripts/test-n4.ts     # expect test-n4: 43/0
npm run build                                 # KI741 - gate on the real build

git add \
  supabase/migrations/0140_notices.sql \
  lib/n4.ts \
  scripts/test-n4.ts \
  DEPLOY-S476-N4-SLICE-A.sh

git commit -m "S476: N4 notice-library Slice A - notices table (mig 0140, applied) + pure arrears/termination logic + tests (43/0)"
git push

echo
echo "Pushed. Migration 0140 already live (applied via MCP). Verify Vercel READY (KI677)."
git rev-parse --short HEAD
