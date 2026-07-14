#!/usr/bin/env bash
# S441 - Suggested-agent assist on the Viewings assign picker.
# Load-balanced HINT (one-tap "Assign {name}" chip), never an auto-assign.
# No migration: uses existing showing_agents.product_types / weekly_capacity +
# showings.assigned_agent_id. Gate was green: tsc clean, eslint clean,
# test-showing-agents 81/0. Live-QA'd on North Star (b733a191), torn down clean.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

# Safety: refuse to run from the wrong repo.
git rev-parse --is-inside-work-tree >/dev/null

git add \
  lib/showing-agents.ts \
  app/dashboard/showings/page.tsx \
  app/dashboard/showings/assign-select.tsx \
  scripts/test-showing-agents.ts

git commit -m "S441: suggested-agent assist on the assign picker (load-balanced hint, not auto-assign)"
git push

echo
echo "Pushed. Now VERIFY the Vercel deploy for this SHA appears (KI677):"
git rev-parse --short HEAD
