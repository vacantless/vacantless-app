#!/usr/bin/env bash
# S438 page-hierarchy + pets P2 fold (one deploy).
#
# (1) Page hierarchy: split the pre-screening settings page so WHICH questions are
#     asked sits near the top and the auto-flag RULES get their own card BELOW
#     "Extra questions for your reference".
#   - settings/actions.ts: updateScreening -> updateScreeningQuestions (master +
#     ask toggles) + updateScreeningFlags (thresholds + pets flag + reason copy);
#     each partial-updates only its own columns.
#   - screening-builtins.tsx: ask-toggles-only island (ScreeningAskToggles).
#   - screening/page.tsx: 3 cards; flag controls grey (static) when their question
#     is off. Codex reviewed the split = no P1/P2.
#
# (2) Codex P2 fold on the anon form: a SUPPRESSED pets question (ask_pets=false)
#     was stored/shown as "Pets: No" instead of null. Replaced the screening_on
#     sentinel with a pets-specific screen_pets_asked sentinel (present only when
#     the pets pills render), so a suppressed pets question arrives null AND pets
#     still flags when income is suppressed but pets is asked.
#   - app/r/[propertyId]/inquiry-form.tsx, app/r/[propertyId]/actions.ts
#
# View + action layer only, no migration. Gate: tsc clean, eslint clean,
# test-screening 162/0.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add \
  app/dashboard/settings/actions.ts \
  app/dashboard/leasing/screening/page.tsx \
  app/dashboard/leasing/screening/screening-builtins.tsx \
  app/r/\[propertyId\]/inquiry-form.tsx \
  app/r/\[propertyId\]/actions.ts \
  DEPLOY-S438-FLAGS-HIERARCHY.sh

git commit -m "S438: split screening settings into Questions / Extra questions / Auto-flag rules cards (two saves) + fold Codex P2 (suppressed pets now arrives null via screen_pets_asked sentinel, not a misleading No)"

git push origin main

echo "Pushed. Verify a Vercel build starts for this SHA; if it doesn't auto-deploy, re-trigger with an empty commit (git commit --allow-empty -m nudge && git push)."
