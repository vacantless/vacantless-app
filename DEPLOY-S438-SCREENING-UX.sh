#!/usr/bin/env bash
# S438 - Fold Codex's first-time-user UX review of the pre-screening page.
# View/action-layer only, NO migration, public/anon submit path untouched.
#   - lib/screening.ts: pure describeScreeningStatus + formatIncomeMultiple (+tests)
#   - screening page: rename to "Pre-screening settings", top status summary
#     (asked-vs-flagged split), relabelled auto-flag inputs, old-vs-new note,
#     workflow bridges (Preview renter form / View possible mismatches)
#   - custom questions: pause/resume (active toggle) + permanent delete on off rows
#   - add-question-form.tsx: progressive-disclosure island (fields per answer type)
#   - settings/actions.ts: setScreeningQuestionActive + deleteScreeningQuestion=hard delete
#   - leads page: "Manage pre-screening" bridge on the Screening filter row
# Gate: tsc clean, eslint clean, test-screening 141/0, test-screening-questions 116/0.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add \
  lib/screening.ts \
  scripts/test-screening.ts \
  app/dashboard/settings/actions.ts \
  app/dashboard/leasing/screening/page.tsx \
  app/dashboard/leasing/screening/add-question-form.tsx \
  app/dashboard/leads/page.tsx \
  codex-handoffs/S438-SCREENING-UX.md \
  DEPLOY-S438-SCREENING-UX.sh

git commit -m "S438: pre-screening page first-time-user UX - status summary (asked vs auto-flag), pause/resume custom questions, progressive-disclosure add form, workflow bridges, clearer copy"

git push origin main

echo "Pushed. Verify a Vercel build starts for this SHA; if it doesn't auto-deploy, re-trigger with an empty commit (git commit --allow-empty -m nudge && git push)."
