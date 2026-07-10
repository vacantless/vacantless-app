#!/usr/bin/env bash
# S451 - Codex QA fold for S450/S450b. CODE ONLY - no migration, no DB change,
# no production data touched.
#
# Review finding folded:
#   S450 fixed the leasing.new_lead send path to prefer member/login fallback
#   before public renter-facing contact fields, but the public showing-cancelled
#   operator alert and Settings > Notifications preview still used the older
#   public-contact-first order. During concierge/proxy onboarding that can still
#   alert or display the intended landlord's real email before handoff.
#
# Fix:
#   - lib/leads-notify.ts now exposes
#     resolveLeadNotifyEmailsPreferMemberFallback.
#   - app/r/[propertyId]/actions.ts, app/showing/cancel/[token]/actions.ts, and
#     app/dashboard/settings/notifications/page.tsx use the same safe order:
#     manage-leads members, then any member/login email, then org public contact
#     as the last resort.
#   - scripts/test-leads-notify.ts covers the shared helper.
#
# Gate:
#   - npx tsx scripts/test-leads-notify.ts: 25/0
#   - npx tsx scripts/test-rental-lifecycle.ts: 84/0
#   - npx tsx scripts/test-property-features.ts: 105/0
#   - npx tsx scripts/test-tenancy-section.ts: 18/0
#   - ./node_modules/.bin/tsc --noEmit --tsBuildInfoFile /private/tmp/vacantless-s451-tsconfig.tsbuildinfo: clean
#   - npm run lint: clean with existing unrelated app/job/[token]/page.tsx <img> warning
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
git rev-parse --is-inside-work-tree >/dev/null

git add \
  'app/r/[propertyId]/actions.ts' \
  'app/showing/cancel/[token]/actions.ts' \
  app/dashboard/settings/notifications/page.tsx \
  lib/leads-notify.ts \
  scripts/test-leads-notify.ts \
  DEPLOY-S451-S450-CODEX-FOLD.sh

git commit -m "S451: fold S450 notification fallback across live event paths"
git push

echo
echo "Pushed. No migration. Verify the Vercel deploy for this SHA is READY + aliased (KI677)."
git rev-parse --short HEAD
