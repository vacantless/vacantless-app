#!/usr/bin/env bash
# S443b - Codex fold on the auto-assign booking path (app/r/[propertyId]/actions.ts only).
# P2-b (FIXED): the capacity week is now anchored on the NEW viewing's scheduled_at
#   (orgWeekWindow(anchorMs,...)), not Date.now() - a next-week booking load-balances
#   against each agent's next-week assignments, not this week's (bookings can be up to
#   the horizon out, default 14 days).
# P2-a (ACCEPTED + DOCUMENTED, no code): the app-layer capacity count -> guarded UPDATE
#   can overrun weekly_capacity by one under a rare simultaneous double-booking. Left as
#   advisory (the manual assign path enforces no cap either; suggestion chip surfaces
#   full agents; low volume; self-correcting). A code comment records the escalation
#   path (a lock-recount RPC applied to BOTH paths) if capacity ever must be a hard cap.
# NO migration. Gate: tsc + eslint clean; test-showing-agents 91/0.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git rev-parse --is-inside-work-tree >/dev/null

git add "app/r/[propertyId]/actions.ts"

git commit -m "S443b Codex fold: anchor auto-assign capacity week on scheduled_at not now (P2-b); document accepted advisory-capacity race (P2-a)"
git push

echo
echo "Pushed. VERIFY the Vercel deploy for this SHA appears (KI677); empty-commit to re-trigger if missing:"
echo "  git commit --allow-empty -m 'S443b redeploy' && git push"
git rev-parse --short HEAD
