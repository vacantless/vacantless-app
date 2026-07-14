#!/usr/bin/env bash
# S443 - Full auto-assign at booking time (ships DARK behind a new opt-in flag).
# When an org turns on organizations.auto_assign_agents, a viewing a renter self-
# books online is automatically routed to the load-balanced showing agent (the
# same pick the manual "Assign {name}" assist suggests), with the
# leasing.showing_assigned hand-off email + a timeline note - exactly as if a lead
# agent had assigned it by hand. Auto-assign REFUSES an at-capacity agent, so a
# full roster (or no roster) leaves the viewing unassigned for manual routing.
#
# Migration 0119 (auto_assign_agents boolean NOT NULL DEFAULT false) is ALREADY
# APPLIED + read-back verified on prod (ref nvhvdyxpyogvadpjlvij); every one of
# the 9 orgs is dark (auto_on=0). This script ships only the app code.
#
# Gate green: tsc clean, eslint clean, test-showing-agents 83 -> 91/0 (6 new
# pickAutoAssignAgent cases: empty/all-archived -> null, least-loaded uncapped
# pick, sole at-capacity -> null while suggest still surfaces it, all-full -> null,
# capped-with-room beats full). Live schema QA on North Star (b733a191): flag on +
# 2 uncapped agents (Alpha 0 / Beta 2 this week) -> the guarded UPDATE routed the
# new unassigned viewing to Alpha (least-loaded), a concurrent replay matched 0
# rows (idempotent, no double-route), confirmation cleared; then both agents capped
# full -> any_pickable=false so it stays unassigned. Seeds torn down clean (roster
# back to 0, flag back to false, 4 baseline showings).
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

# Safety: refuse to run from the wrong repo.
git rev-parse --is-inside-work-tree >/dev/null

git add \
  lib/showing-agents.ts \
  lib/org.ts \
  app/r/[propertyId]/actions.ts \
  app/dashboard/showing-agents/actions.ts \
  app/dashboard/showing-agents/page.tsx \
  scripts/test-showing-agents.ts \
  supabase/migrations/0119_auto_assign_agents.sql

git commit -m "S443: full auto-assign at booking time (dark opt-in flag; load-balanced, capacity-respecting)"
git push

echo
echo "Pushed. Now VERIFY the Vercel deploy for this SHA appears (KI677);"
echo "if it doesn't build within a minute, re-trigger with an empty commit:"
echo "  git commit --allow-empty -m 'S443 redeploy' && git push"
git rev-parse --short HEAD
