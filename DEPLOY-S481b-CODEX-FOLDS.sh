#!/usr/bin/env bash
# S481b - fold Codex's S481 (N4 Slice C) review: 1 P1 + 3 P2 + 1 P3. Code only,
# NO migration. Commits on top of 6f3302a (S481).
#
# FOLDS
#  P1 override overstatement (lib/n4.ts + lib/n4-snapshot.ts): resolveN4OwingCents
#     let any override "win" and n4SnapshotBlocker only rejected rows>total, so an
#     operator could serve an N4 with a total ABOVE the ledger arrears (a void N4).
#     Now: (a) n4SnapshotBlocker also rejects total>rowsOwe -> new "overstated"
#     reason; (b) new pure creditN4RowsToTotal reconciles a DOWN override by
#     crediting the reduction against the most-recent rows (charged-paid=owing
#     preserved, rows sum EXACTLY to the total); an override above the ledger is
#     left unreconciled and blocked. The override is now down-only + safe.
#  P2 service-method timing (n4-actions.ts + n4-section.tsx): mail/courier were
#     selectable at record-service time but the snapshot froze termination =
#     notice+14 with no deemed-service add-on -> a mail/courier N4 with hand
#     timing. v1 now records IN-PERSON (hand) service ONLY; mail/courier (deemed-
#     service date math) deferred to the legal-verify gate (design section 6).
#  P2 fileN4ToVault idempotency (n4-actions.ts): was read-null-then-write, so a
#     concurrent double-submit could create two vault docs. Now RESERVES the
#     filing slot first (CAS: update filed_document_id where is null, .select());
#     the loser does no upload/insert; the winner rolls the reservation back if
#     the fill/upload/insert fails (S479 reserve-before-side-effects model).
#  P2 public HTML parity (app/notice/[token]/route.ts): the HTML summary now also
#     requires n4SnapshotReady (the /official PDF route already did), so a non-
#     reconciling served snapshot 404s on BOTH, not just the PDF.
#  P3 lint (n4-section.tsx): escape unescaped apostrophes (react/no-unescaped-
#     entities) at the three flagged JSX-text lines; eslint now clean.
#
# Verified on device: tsc --noEmit 0 errors; eslint clean (touched files); tests
#   test-n4 83/0, test-n4-pdf 22/0, test-n4-snapshot 35/0, test-distribution-
#   concierge 60/0; headless smoke (down override reconciles + fills a valid PDF;
#   over override -> "overstated"). Codex's paused S480b settings-tabs.tsx stays
#   uncommitted (NOT staged here).
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
git rev-parse --is-inside-work-tree >/dev/null

node_modules/.bin/tsx scripts/test-n4.ts                      # expect test-n4: 83/0
node_modules/.bin/tsx scripts/test-n4-pdf.ts                  # expect test-n4-pdf: 22/0
node_modules/.bin/tsx scripts/test-n4-snapshot.ts             # expect test-n4-snapshot: 35/0
node_modules/.bin/tsx scripts/test-distribution-concierge.ts  # expect 60/0 (S479 invariant)
npm run build                                                 # KI741 - the real build gate

git add \
  lib/n4.ts \
  lib/n4-snapshot.ts \
  "app/notice/[token]/route.ts" \
  app/dashboard/tenancies/n4-actions.ts \
  "app/dashboard/tenancies/[id]/n4-section.tsx" \
  scripts/test-n4.ts \
  scripts/test-n4-snapshot.ts \
  DEPLOY-S481b-CODEX-FOLDS.sh

git commit -m "S481b: fold Codex S481 review - P1 N4 override overstatement (block total>rows + down-only row-credit reconcile); P2 hand-only service (defer mail/courier deemed-service); P2 fileN4ToVault reserve-before-side-effects; P2 public HTML n4SnapshotReady parity; P3 lint. tsc/eslint clean; n4 83/0, n4-pdf 22/0, n4-snapshot 35/0, concierge 60/0"
git push

echo
echo "Pushed. NO migration. Verify Vercel READY (KI677). Codex's settings-tabs.tsx still uncommitted."
git rev-parse --short HEAD
