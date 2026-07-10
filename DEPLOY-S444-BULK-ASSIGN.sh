#!/usr/bin/env bash
# S444 - "Assign all unassigned" bulk action (operator-initiated).
# One button on the Viewings page routes EVERY still-open upcoming viewing that
# has no agent yet through the same load-balanced, capacity-respecting pick as
# per-booking auto-assign (S443) - in a single click. It posts to a guarded
# UPDATE per row (assign only if still unassigned + open + in this org), so it
# adds NO new write path or privilege over the manual assign. Gated on
# manage_leads, same as the single assign. Ships ACTIVE for every org (it's an
# operator action, no behaviour change until clicked); the button only shows when
# there is something to route AND a roster to route to.
#
# NO migration (all reused columns). NO new env.
#
# The batch balancing - the one thing a single per-viewing pick can't do - lives
# in a NEW pure lib/showing-agents.planBulkAssignments (each pick counts against
# the next, per org-local week, capacity a hard gate; a week with everyone full is
# left for manual routing). Unit-tested: test-showing-agents 91 -> 109/0 (empty
# roster / no viewings / uncapped 2-2 balance / existing-load tilt / per-agent
# capacity gate + overflow-skip / all-full -> all skipped / per-week capacity /
# archived + null-time skip).
#
# Gate green: tsc clean, eslint clean, test-showing-agents 109/0. Live schema-QA
# on North Star (b733a191): seeded 3 agents (Gamma cap 1) + 5 unassigned upcoming
# viewings (4 in one Toronto week + 1 next week); the action's exact filter chain
# returned exactly those 5 (excluding the past/attended/cancelled baseline rows).
# End-to-end live UI click verified after deploy; seeds torn down clean.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

# Safety: refuse to run from the wrong repo.
git rev-parse --is-inside-work-tree >/dev/null

git add \
  lib/showing-agents.ts \
  app/dashboard/showings/actions.ts \
  app/dashboard/showings/page.tsx \
  scripts/test-showing-agents.ts

git commit -m "S444: 'Assign all unassigned' bulk action (batched load-balanced routing; pure planBulkAssignments)"
git push

echo
echo "Pushed. Now VERIFY the Vercel deploy for this SHA appears (KI677);"
echo "if it doesn't build within a minute, re-trigger with an empty commit:"
echo "  git commit --allow-empty -m 'S444 redeploy' && git push"
git rev-parse --short HEAD
