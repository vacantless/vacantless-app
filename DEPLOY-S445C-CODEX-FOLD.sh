#!/usr/bin/env bash
# S445c - fold Codex's two P2s from the S444 + S445 reviews (no P1 in either).
#
# P2 (S445, migration 0120): the agent-token outcome RPC could record attended /
# no_show for an OPEN viewing whose scheduled_at is still in the FUTURE (the page
# hides the buttons until scheduled_at <= now, but the token RPC is the source of
# truth). Fix: reject with reason 'too_early' when scheduled_at is null or > now(),
# before the update. The updated function is ALREADY RE-APPLIED on prod (ref
# nvhvdyxpyogvadpjlvij) via CREATE OR REPLACE.
#
# P2 (S444, app/dashboard/showings/page.tsx): the "Assign N unassigned" button
# counted from `upcoming`, which is scheduled-only, while assignAllUnassigned
# includes outcome null OR 'scheduled'. Fix: count with the SAME open-upcoming
# predicate (unassigned + future + outcome null/'scheduled') so a legacy null-
# outcome open viewing is counted, not silently assignable-but-hidden.
#
# Gate green: tsc clean, eslint clean, test-showing-agents 109/0. Live-verified the
# guard on North Star (b733a191): a future assigned viewing -> {ok:false,too_early}
# with outcome unchanged; a past one still records attended. Torn down clean.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git rev-parse --is-inside-work-tree >/dev/null

git add \
  supabase/migrations/0120_record_showing_outcome_from_agent_token.sql \
  app/dashboard/showings/page.tsx \
  DEPLOY-S445C-CODEX-FOLD.sh

git commit -m "S445c: fold Codex P2s - too_early guard on agent-token outcome RPC (S445); bulk-assign count matches action's open predicate (S444)"
git push

echo
echo "Pushed. RPC already re-applied on prod. Verify the Vercel deploy for this SHA"
echo "appears (KI677); re-trigger with an empty commit if it doesn't build."
git rev-parse --short HEAD
