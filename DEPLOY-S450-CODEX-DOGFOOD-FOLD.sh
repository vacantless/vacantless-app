#!/usr/bin/env bash
# S450 - fold the confidently-fixable findings from the S448-S450 Paul Schwartz /
# 10 Bellair #1604 production dogfood (Codex, July 10). CODE ONLY - NO migration,
# NO DB change, NO production data touched. Four fixes + focused tests.
#
# #1 (P2) Notification recipient safety for proxy/concierge onboarding
#    [app/r/[propertyId]/actions.ts]: the leasing.new_lead operator-alert fallback
#    used to prefer the org's PUBLIC renter-facing reply-to / contact address over
#    a real member/login email. During proxy onboarding that public address is
#    often the real landlord being set up on their behalf (e.g. Paul Schwartz), so
#    a lead alert driven by the proxy login could reach him. Now the fallback
#    prefers a real member/login email; the public contact stays an absolute last
#    resort so a lead is never silently dropped. (Codex #1)
#
# #2 (P2/P3) Terminal cancelled viewings [app/dashboard/showings/outcome-select.tsx]:
#    a cancelled viewing no longer renders the Scheduled/Attended/No-show/Cancelled
#    action buttons (which invited recording an attendance on a viewing that never
#    happened). It shows a static "Cancelled" state on both the Viewings page and
#    lead detail (both render OutcomeSelect). Re-engaging is a fresh booking, not an
#    outcome flip. (Codex #2)
#
# #7 (handoff-confidence) "Screen 1 application" with Applied=0
#    [lib/rental-lifecycle.ts]: the Screen step counted leads at rank >= applied,
#    which INCLUDED leased leads, so a leased unit with no in-app application
#    reported "1 application". Now it counts only leads actually at the application
#    stage; a leased/tenanted unit with none reads "No application on file". (Codex #7)
#
# #9 (handoff-confidence) "Level 15 floor" [lib/property-features.ts]: the spec
#    line appended " floor" unless the value ended in "floor", so a condo level
#    typed "Level 15" rendered "Level 15 floor". Now it also skips the append when
#    the value already names a floor/level. (Codex #9)
#
# NOT in this deploy (tracked separately):
#   - Codex #3 (set-password link -> /login#access_token): ALREADY FIXED on the
#     deployed HEAD by S447 (/auth/callback both-flows) + S448 (/auth/confirm
#     token_hash). No code change needed; the dogfood ran against an older deploy.
#   - Codex #6 (lease card "Not started" despite 4 docs) + #8 (People page "0
#     documents"): need the document-model detail / a read-only look at how the 4
#     docs are stored - pending.
#   - Codex #4 (operator "prepare account" path) + #5 (owner-transfer / login-email
#     change): feature-sized, pending Noam's design sign-off.
#
# Gate: tsc clean; eslint clean; tests green (leads-notify 22, rental-lifecycle 84,
# property-features 105).
#
# POST-DEPLOY LIVE QA (once the SHA is READY; use North Star QA org b733a191, NOT
# Paul's org - do not trigger live events on Paul's org):
#   - New-lead alert: an org with a non-leasing member + a public reply-to sends
#     the new-inquiry alert to the member/login, not the public contact.
#   - Cancelled viewing: a cancelled row on Viewings + lead detail shows a static
#     "Cancelled" (no Attended/No-show buttons).
#   - Spine: a leased unit with no application reads "No application on file" on the
#     Screen step; a condo "Level 15" renders "Level 15" (not "Level 15 floor").
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git rev-parse --is-inside-work-tree >/dev/null

git add \
  'app/r/[propertyId]/actions.ts' \
  'app/dashboard/showings/outcome-select.tsx' \
  'lib/rental-lifecycle.ts' \
  'lib/property-features.ts' \
  'scripts/test-leads-notify.ts' \
  'scripts/test-rental-lifecycle.ts' \
  'scripts/test-property-features.ts' \
  DEPLOY-S450-CODEX-DOGFOOD-FOLD.sh

git commit -m "S450: fold Codex dogfood findings - prefer operator/login over public reply-to for new-lead alerts (proxy-onboarding safety), hide outcome actions on terminal cancelled viewings, stop counting leased leads as applications on the Screen step, and fix 'Level 15 floor' spec-line doubling. Code only, no migration."
git push

echo
echo "Pushed. No migration. Verify the Vercel deploy for this SHA is READY + aliased (KI677), then run the POST-DEPLOY LIVE QA above on North Star (b733a191)."
git rev-parse --short HEAD
