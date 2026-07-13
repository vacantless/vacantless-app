#!/usr/bin/env bash
# S481 - N4 notice-library, Slice C (operator Prepare-N4 flow + public routes).
# Extends the LIVE N1 frozen-snapshot lane to the LTB Form N4 (arrears). CODE ONLY,
# NO migration (the `notices` table + every column used shipped in 0140, S476).
#
# POSTURE: prepare-first (design section 4). The app derives arrears from the rent
# + rent_payments ledger, freezes the operator's reviewed figures into an immutable
# notices.snapshot, and fills the official Board-approved Form N4 for the OPERATOR
# to serve THEMSELVES. There is NO serve-on-behalf (still gated behind the per-form
# legal-verify pass, design section 6). Every write authorizes against + stamps
# organization_id from the RESOURCE's own org (the tenancy / notice row), never
# getCurrentOrg() (KI744/748).
#
# Files (all N4-scoped; Codex's paused S480b edit to components/settings-tabs.tsx
# is deliberately NOT staged here and stays as an uncommitted working change):
#   lib/n4-snapshot.ts                                   - parked pure spine now committed
#       (buildN4Snapshot + n4SnapshotBlocker + snapshotToN4Fill); test 26/0.
#   scripts/test-n4-snapshot.ts                          - the spine's unit test (26/0).
#   lib/n4-render.ts                                     - tenant-facing HTML summary.
#   app/notice/[token]/route.ts                          - public N4 summary (served only).
#   app/notice/[token]/official/route.ts                 - public official Form N4 PDF (served only).
#   app/dashboard/tenancies/[id]/n4/official/route.ts    - operator PDF download (draft/served).
#   app/dashboard/tenancies/n4-actions.ts                - prepareN4 / recordN4Service /
#       fileN4ToVault / voidN4 (manage_tenancies-gated; resource-org stamped).
#   app/dashboard/tenancies/[id]/n4-section.tsx          - operator Prepare-N4 UI.
#   app/dashboard/tenancies/[id]/page.tsx (edit)         - load notices + render the section.
#   next.config.mjs (edit)                               - bundle ltb-n4-2022.pdf into
#       the /notice/[token]/official serverless function (KI: file-trace or 500).
#
# Verified on device: tsc --noEmit clean (0 errors); tests via CJS-transpile+node
#   n4 75/0, n4-pdf 22/0, n4-snapshot 26/0, distribution-concierge 60/0 (S479
#   invariant preserved). next build could NOT run on device (KI716) -> this script
#   is the authoritative build gate on the Mac.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
git rev-parse --is-inside-work-tree >/dev/null

node_modules/.bin/tsx scripts/test-n4.ts                      # expect test-n4: 75/0
node_modules/.bin/tsx scripts/test-n4-pdf.ts                  # expect test-n4-pdf: 22/0
node_modules/.bin/tsx scripts/test-n4-snapshot.ts             # expect test-n4-snapshot: 26/0
node_modules/.bin/tsx scripts/test-distribution-concierge.ts  # expect 60/0 (S479 invariant)
npm run build                                                 # KI741 - gate on the real build

git add \
  lib/n4-snapshot.ts \
  scripts/test-n4-snapshot.ts \
  lib/n4-render.ts \
  "app/notice/[token]/route.ts" \
  "app/notice/[token]/official/route.ts" \
  "app/dashboard/tenancies/[id]/n4/official/route.ts" \
  app/dashboard/tenancies/n4-actions.ts \
  "app/dashboard/tenancies/[id]/n4-section.tsx" \
  "app/dashboard/tenancies/[id]/page.tsx" \
  next.config.mjs \
  DEPLOY-S481-N4-SLICE-C.sh

git commit -m "S481: N4 notice-library Slice C - operator Prepare-N4 flow (prepare-first, freeze snapshot, official PDF + vault) + public /notice/[token](/official) routes; no migration; gates tsc + n4 75/0 + n4-pdf 22/0 + n4-snapshot 26/0 + concierge 60/0"
git push

echo
echo "Pushed. NO migration. Codex's settings-tabs.tsx stays uncommitted (S480b, paused)."
echo "Verify Vercel READY (KI677), then first-use verify on North Star QA:"
echo "  prepare a test N4 -> Download official N4 (PDF) -> record service -> open /notice/<token>/official and eyeball the filled gov form."
git rev-parse --short HEAD
