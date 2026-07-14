#!/usr/bin/env bash
# S436c - fold Codex's S436 review (P1a cross-org, P1b dropped agent, P2 cancel
# race, P3 forbidden-click UX). Adds ONLY the fold files - migration 0115
# (Slice 2 confirmation) is NOT part of this commit.
#
# PREREQUISITE: migration 0114_showing_agent_same_org.sql is ALREADY APPLIED to
# prod (Claude applied + live-proved it via the Supabase connector). The trigger
# is safe against the currently-live code (legit assignments are same-org), so
# ordering is not sensitive here.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add \
  supabase/migrations/0114_showing_agent_same_org.sql \
  app/dashboard/showings/actions.ts \
  app/dashboard/showings/page.tsx \
  lib/notifications.ts \
  scripts/test-notifications.ts \
  codex-handoffs/S436-SHOWING-AGENTS-ROUTING.md

git commit -m "S436c: fold Codex review - same-org assignment guard (app + DB trigger 0114), always-notify assigned agent, guarded update, role-gated controls"

git push origin main

echo "Pushed. Watch Vercel for the build; re-trigger with an empty commit if it doesn't auto-deploy."
