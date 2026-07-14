#!/usr/bin/env bash
# S441 Codex fold - 2 of 3 P3s folded (no migration, no behavior change today):
#   P3-a lib/showing-agents.ts: product-type narrowing now drops WRONG-type
#        specialists whenever that leaves someone, so a generalist beats a
#        sale-only agent for a rental even with no rental specialist (latent -
#        productType still unset by the caller today).
#   P3-c assign-select.tsx: when the suggested agent is at weekly capacity the
#        chip goes amber + shows an always-visible "· full" marker (the "N left"
#        reason is hidden on small screens). Still tappable - operator's call.
#   P3-b orgWeekWindow DST boundary: DEFERRED with a documented comment (matches
#        the accepted leasing-snapshot tz simplification; single edge-hour twice
#        a year on a capacity hint).
# Gate: tsc + eslint clean; test-showing-agents 81 -> 83/0.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
git rev-parse --is-inside-work-tree >/dev/null

git add \
  lib/showing-agents.ts \
  app/dashboard/showings/assign-select.tsx \
  scripts/test-showing-agents.ts

git commit -m "S441 Codex fold: product-type narrowing drops wrong-type specialists (P3), at-capacity suggestion chip goes amber + visible 'full' (P3), document accepted DST week-boundary edge (P3)"
git push

echo
echo "Pushed. Now VERIFY the Vercel deploy for this SHA appears (KI677):"
git rev-parse --short HEAD
