#!/usr/bin/env bash
# S438 Slice 2 - per-built-in "ask this question" toggles.
# Migration 0116 is ALREADY APPLIED to prod (Claude applied + read-back verified
# via the Supabase connector); the file is committed for repo history. Default
# true keeps every existing org asking all built-ins, so the migration is safe
# ahead of this code deploy.
#   - lib/screening.ts: OrgScreeningConfig + describeScreeningStatus + validate honor ask flags (+tests, 162/0)
#   - lib/org.ts: 4 columns on Org type + select
#   - public form: get_public_listing keys -> r/[propertyId] -> inquiry-form gates income/movein/pets/occupants
#   - settings: screening-builtins.tsx island (per-built-in ask checkbox + option-A greyed flag) + updateScreening reads them
# Gate: tsc clean, eslint clean, test-screening 162/0.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add \
  supabase/migrations/0116_screening_ask_toggles.sql \
  lib/screening.ts \
  lib/org.ts \
  scripts/test-screening.ts \
  app/dashboard/settings/actions.ts \
  app/dashboard/leasing/screening/page.tsx \
  app/dashboard/leasing/screening/screening-builtins.tsx \
  app/r/\[propertyId\]/page.tsx \
  app/r/\[propertyId\]/inquiry-form.tsx \
  codex-handoffs/S438-SCREENING-UX.md \
  SLICE2-SCREENING-PER-QUESTION-TOGGLES-SCOPE-2026-07-08.md \
  DEPLOY-S438-SLICE2-ASK-TOGGLES.sh

git commit -m "S438 Slice 2: per-built-in ask toggles - screening_ask_income/movein/pets/occupants (0116, default true), public form gating, settings per-question ask checkboxes with option-A inert flags"

git push origin main

echo "Pushed. Verify a Vercel build starts for this SHA; if it doesn't auto-deploy, re-trigger with an empty commit (git commit --allow-empty -m nudge && git push)."
