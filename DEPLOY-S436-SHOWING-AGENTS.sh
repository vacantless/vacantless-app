#!/usr/bin/env bash
# S436 - Multi-operator showing routing, Slice 1 (showing agents + assignment).
# Adds ONLY the S436 files so the pre-existing uncommitted artifacts (stale
# DEPLOY-*.sh, dirty codex-handoffs/*.md) are left untouched, per S430.
#
# PREREQUISITE: migration 0113_showing_agents.sql must be applied to the prod DB
# FIRST (additive + live-safe: new showing_agents table + nullable
# showings.assigned_agent_id/assigned_at). The code selects those columns, so
# deploying before the migration lands would 500 the Viewings + Showing-agents
# pages. Claude applies 0113 via the Supabase connector (ref nvhvdyxpyogvadpjlvij)
# on Noam's go, then this script ships the code.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add \
  lib/showing-agents.ts \
  scripts/test-showing-agents.ts \
  supabase/migrations/0113_showing_agents.sql \
  lib/notifications.ts \
  app/dashboard/dashboard-nav.tsx \
  app/dashboard/showings/actions.ts \
  app/dashboard/showings/page.tsx \
  app/dashboard/showings/assign-select.tsx \
  app/dashboard/showing-agents/page.tsx \
  app/dashboard/showing-agents/actions.ts

git commit -m "S436: multi-operator showing routing Slice 1 - showing_agents roster + assign-a-viewing (migration 0113, leasing.showing_assigned notification)"

git push origin main

echo "Pushed. Vercel will auto-deploy from main. Verify the deploy goes Ready in the Vercel dashboard."
