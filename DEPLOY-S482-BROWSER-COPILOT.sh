#!/usr/bin/env bash
# S482 - Browser CO-PILOT transport for first-class distribution (the honest
# "browser_copilot" path from the S480 capability matrix). Vacantless CANNOT post
# to Facebook/Kijiji/Viewit for the operator (no supported LTR API + ToS forbid
# silent automation), so it CO-PILOTS: prepares channel-fit copy + the tracked
# link, guides each step, and STOPS at every human gate (login / payment /
# CAPTCHA / final review). The operator posts, then pastes the LIVE ad URL as
# proof - completeCopilotPost records durable proof + an append-only attempt
# (actor=browser_copilot) FIRST, then flips the run item live + writes/refreshes
# the tracked listing_posts row (terminal-flip-last). NEVER live without a real
# URL (canMarkCopilotLive). Org stamped from the RESOURCE's own org (KI748).
# NO migration. No credentials stored. listing_posts stays canonical attribution.
#
# PREREQ ORDERING: commit the S480b channel-setup Settings slice FIRST (its own
# review: codex-handoffs/CODEX-QA-HANDOFF-S480b-CHANNEL-SETUP.md). It carries the
# launch-run-panel.tsx "Channel setup" header hunks; this script stages the
# REMAINING (co-pilot body) hunks. The guard below aborts if S480b isn't in yet.
set -euo pipefail
export GIT_LITERAL_PATHSPECS=1
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
git rev-parse --is-inside-work-tree >/dev/null

# Ordering guard: the S480b settings slice (which owns the launch-run-panel
# "Channel setup" header hunks) must be committed before S482, so those hunks do
# not land in this commit.
if ! git show "HEAD:components/settings-tabs.tsx" | grep -q "distribution"; then
  echo "ABORT: commit the S480b channel-setup Settings slice FIRST (settings-tabs.tsx must carry the Distribution tab)."
  echo "       See codex-handoffs/CODEX-QA-HANDOFF-S480b-CHANNEL-SETUP.md"
  exit 1
fi

# Gates (Mac): pure co-pilot tests + full typecheck + build. next build canNOT
# run on-device, so it is the authoritative gate here.
node_modules/.bin/tsx scripts/test-distribution-copilot.ts   # expect 57/0
node_modules/.bin/tsc --noEmit
npm run build

git add \
  lib/distribution-copilot.ts \
  scripts/test-distribution-copilot.ts \
  "app/dashboard/properties/[id]/copilot-panel.tsx" \
  app/dashboard/properties/distribution-actions.ts \
  "app/dashboard/properties/[id]/page.tsx" \
  "app/dashboard/properties/[id]/launch-run-panel.tsx" \
  DEPLOY-S482-BROWSER-COPILOT.sh \
  codex-handoffs/CODEX-QA-HANDOFF-S482-BROWSER-COPILOT.md

git commit -m "S482: browser co-pilot transport - honest guided posting to Facebook/Kijiji/Viewit (channel-fit copy + tracked link + stop-gates); completeCopilotPost records proof+attempt (actor browser_copilot) then flips live + tracked listing_post, never live without a real URL. lib/distribution-copilot.ts 57/0; no migration; tsc/lint/build clean."
git push
echo
echo "Pushed S482. Verify Vercel READY (KI677), then live-QA on North Star Rentals QA."
git rev-parse --short HEAD
