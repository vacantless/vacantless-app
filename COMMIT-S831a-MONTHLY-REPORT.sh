#!/bin/bash
# S831a: the per-rental monthly report. Migration 0321 is ALREADY APPLIED (Claude, 2026-11-23).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'export function buildRentalReport' lib/rental-report.ts || { echo "STOP: rental-report missing"; exit 1; }
grep -q '"you-rental-report"' lib/message-catalog.ts || { echo "STOP: catalog row missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s831-rental-report.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0321_rental_report.sql \
  lib/rental-report.ts lib/rental-report-server.ts lib/email.ts lib/message-catalog.ts lib/cron-sweeps.ts \
  app/api/cron/rental-report/route.ts \
  "app/dashboard/properties/[id]/report-actions.ts" "app/dashboard/properties/[id]/monthly-report-card.tsx" "app/dashboard/properties/[id]/page.tsx" \
  app/dashboard/reports/page.tsx app/dashboard/reports/actions.ts \
  app/dashboard/automations/every-message/page.tsx \
  .github/workflows/reminders.yml \
  scripts/test-s831-rental-report.ts scripts/test-s824j-extra-recipients.ts scripts/test-plain-language.ts scripts/plain-language-baseline.json \
  COMMIT-S831a-MONTHLY-REPORT.sh
git diff --cached --name-only
git commit -m "S831a: a monthly report for each advertised rental

Noam's ask, styled after his Suite 503 owner update: Latest work and next
steps, Response so far, Marketing to date. Sent on the 1st from 9 am
Toronto to owners and admins plus Also send to, once per month per rental
(rental_report_sent_month). Switch on Every message we send (on for all).
The rental page gets a Next steps note and Send this month so far to me.
Costs can now belong to one rental (marketing_costs.property_id, Reports
picker); a site with no cost says no cost entered, never free. Accounts
that book viewings themselves skip the empty viewings line. Migration 0321.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqrYaTbtLw6Gm8kuG1"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
