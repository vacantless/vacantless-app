#!/usr/bin/env bash
# S445d - fold Codex's S445b P2: the outcome nudge links the agent to
# /agent/[token], but that page only showed viewings within 2h of start, so the
# 2h/20h/44h nudges landed on "No upcoming viewings" and the outcome could never be
# recorded from the nudge — breaking the S445 -> S445b loop end to end.
#
# Fix (app/agent/[token]/page.tsx, view-layer only, NO migration): widen the page
# query to the 7d outcome-nudge backlog window (OUTCOME_NUDGE_MAX_AGE_MS) and split
# it into two sections — "N viewings to wrap up" (past-but-open assigned viewings,
# most recent first, with the one-tap Renter showed / No-show) and "N upcoming
# viewings" (future, Confirm). The shared card renderer is factored out. Closed /
# cancelled viewings still drop off.
#
# Gate green: tsc clean, eslint clean. Verified live on North Star after deploy: a
# seeded past-open assigned viewing renders under "to wrap up" with the outcome
# buttons; recording it clears it from the page.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git rev-parse --is-inside-work-tree >/dev/null

git add \
  'app/agent/[token]/page.tsx' \
  DEPLOY-S445D-AGENT-NEEDS-OUTCOME.sh

git commit -m "S445d: fold Codex S445b P2 - agent page shows past-open viewings needing an outcome (7d window + Needs-outcome section), so nudges land on an actionable page"
git push

echo
echo "Pushed. No migration. Verify the Vercel deploy for this SHA appears (KI677)."
git rev-parse --short HEAD
