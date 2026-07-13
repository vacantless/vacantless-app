#!/usr/bin/env bash
# S482b - fold Codex's S482 review (1 P1 + 2 P2). NO migration.
#
# P1 (live-without-proof bypass): LaunchRunPanel rendered the generic
# updateRunItem status form for co-pilot items alongside the co-pilot panel, and
# updateRunItem writes publish_status='live' even with a blank URL (no proof, no
# tracker). FIX: (a) hide the generic status form for co-pilot items
# (launch-run-panel.tsx - only the co-pilot completion path remains); (b) server
# guard in updateRunItem refuses a live flip for any browser_copilot channel
# (isCopilotChannel) - they go live ONLY through completeCopilotPost.
#
# P2 (no reservation/CAS): completeCopilotPost now (1) rejects a stale form on a
# non-active run or a concierge-handed item, (2) RESERVES the item via a
# state-conditional CAS (publish_status -> 'submitting' only from a
# non-live/non-submitting state) so a concurrent double-submit can't both insert
# a duplicate live listing_posts tracker, and (3) terminal-flips LAST gated on
# still holding the reservation.
#
# P2 (fail-closed writes): recordVerificationAndAttempt returns null if the
# attempt insert OR the run-item update errors (was: only the verification
# insert). completeCopilotPost checks the proof result AND the listing_posts
# update/insert errors; on any failure it RELEASES the reservation and does NOT
# mark the item live - preserving "durable proof + attempt first, terminal flip
# last" on write failure.
set -euo pipefail
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
git rev-parse --is-inside-work-tree >/dev/null

node_modules/.bin/tsx scripts/test-distribution-copilot.ts   # expect 57/0
node_modules/.bin/tsc --noEmit
npm run build

git add \
  app/dashboard/properties/distribution-actions.ts \
  app/dashboard/properties/actions.ts \
  "app/dashboard/properties/[id]/launch-run-panel.tsx" \
  codex-handoffs/CODEX-QA-HANDOFF-S482-BROWSER-COPILOT.md \
  DEPLOY-S482b-CODEX-P1-P2-FOLDS.sh

git commit -m "S482b: fold Codex S482 review (1 P1 + 2 P2). P1 co-pilot live-without-proof bypass closed (hide generic updateRunItem form for co-pilot items + server guard refusing a live flip for browser_copilot channels). P2 completeCopilotPost adds run-active/concierge guards + state-conditional CAS reservation (no duplicate trackers) + terminal-flip-last. P2 fail-closed: recordVerificationAndAttempt returns null on attempt/item-update error; completeCopilotPost releases the reservation + does not go live on proof/tracker write failure. No migration; tsc/lint/build clean; copilot 57/0."
git push
echo
echo "Pushed S482b. Verify Vercel READY (KI677), then re-QA the bypass is closed on North Star."
git rev-parse --short HEAD
