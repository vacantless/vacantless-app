#!/usr/bin/env bash
# S436 Slice 2 - showing confirmation trail (the "did the agent confirm?" gap).
# Migration 0115 is ALREADY APPLIED to prod (Claude applied + read-back verified);
# this deploy is code + the migration file for the repo record.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add \
  supabase/migrations/0115_showing_confirmation.sql \
  lib/showing-agents.ts \
  scripts/test-showing-agents.ts \
  app/dashboard/showings/actions.ts \
  app/dashboard/showings/page.tsx \
  app/dashboard/showings/confirm-control.tsx \
  codex-handoffs/S436-SLICE2-CONFIRMATION.md

git commit -m "S436 Slice 2: showing confirmation trail - confirmed_at/confirmed_by (0115), coordination status, Mark-confirmed control + awaiting-confirmation oversight"

git push origin main

echo "Pushed. Watch Vercel for the build; re-trigger with an empty commit if it doesn't auto-deploy."
