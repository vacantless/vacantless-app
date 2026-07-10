#!/usr/bin/env bash
# S447b - fold the P2/P3 findings from the S447 Paul-Schwartz production dogfood
# (Codex July 10). Six fixes; NO auth change (that's DEPLOY-S447). Migration 0122
# was ALREADY applied to the DB via the Supabase connector - the .sql is committed
# here only for version history (Vercel does not run migrations).
#
# 1. (P2) listing_posts + showing_agents DB hardening [migration 0122, APPLIED].
#    - CHECK: a 'live' listing_post must carry a non-blank url (validateListingPost
#      guarded the server action, but a direct authenticated write bypassed it).
#      One pre-existing url-less live row (Maple Door) was demoted to draft.
#    - REVOKE DELETE on showing_agents from authenticated: the model is archive-
#      only (assignment history must survive); service_role keeps delete for crons
#      + the org ON DELETE CASCADE. The app has no hard-delete path.
#
# 2. (P2) Relist guard [app/dashboard/properties/actions.ts + [id]/page.tsx]:
#    updateProperty (the Status-dropdown "power-user escape hatch") no longer
#    silently flips a LEASED unit back to 'available' while an active/upcoming
#    tenancy exists. It keeps the unit Leased (other edits still save) and the page
#    shows a "Relist anyway" confirm (new relistLeasedProperty action). publishProperty
#    already guarded this; this closes the escape hatch.
#
# 3. (P2) Feed cache staleness [app/api/feed/[org]/route.ts]: Cache-Control
#    max-age/s-maxage 300 -> 60 (+ stale-while-revalidate=60), so a delist/re-lease
#    clears the syndication feed within ~a minute instead of up to five.
#
# 4. (P3) Distribute feed blocker [app/dashboard/properties/[id]/page.tsx]: the
#    per-channel feed note (which already NAMES the blocker via feedSignal, e.g.
#    "add Photo") now renders regardless of the marketing-kit entitlement, so a
#    free-plan operator learns why a Live listing isn't in the feed.
#
# 5. (P3) Handoff email CC [lib/notifications.ts]: the showing_assigned and
#    showing_rescheduled emails told the covering agent to "keep the lead agent
#    CC'd" but gave no address. Added a "Lead agent (keep CC'd): {{assigned_by}}"
#    / "{{rescheduled_by}}" line (both tokens are the assigning operator's email).
#
# 6. (P3) Cancelled-viewing cue [app/dashboard/leads/[id]/page.tsx]: a lead stuck
#    at "Booked" after its only viewing was cancelled now shows an amber cue. NOTE:
#    the cancel RPCs (0108/0109) DELIBERATELY leave the lead stage to the operator,
#    so this is the design-consistent "make the cancellation obvious" fix Codex
#    suggested - NOT an auto-revert (which would fight that documented decision).
#
# Gate: tsc clean; eslint clean; tests green (notifications 91, showing-agents 109,
# booking 54, reminders 13, listing-distribution 66, listing-feed 133,
# listing-quality 25, leads-notify 20).
#
# POST-DEPLOY LIVE QA (once the SHA is READY, use North Star QA org b733a191):
#   - Relist: on a leased unit WITH an active tenancy, set Status->Available via
#     the edit form: it stays Leased + shows the "Relist anyway" banner; the button
#     relists it. A leased unit with NO active tenancy relists normally.
#   - Distribute: a free-plan Live unit missing a photo shows the "add Photo" feed
#     note on the Distribute tab.
#   - Cancelled cue: a booked lead whose only showing is cancelled shows the amber
#     cue on the lead page.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git rev-parse --is-inside-work-tree >/dev/null

git add \
  'supabase/migrations/0122_hardening_listing_post_url_and_showing_agent_archive.sql' \
  'app/api/feed/[org]/route.ts' \
  'lib/notifications.ts' \
  'app/dashboard/properties/actions.ts' \
  'app/dashboard/properties/[id]/page.tsx' \
  'app/dashboard/leads/[id]/page.tsx' \
  DEPLOY-S447B-CODEX-DOGFOOD-P2-P3-FOLDS.sh

git commit -m "S447b: fold Codex dogfood P2/P3s - listing_post/showing_agent DB hardening (0122), relist-over-active-tenancy guard, feed cache 300->60s, always-on Distribute feed blocker, handoff email lead-agent CC line, cancelled-viewing lead cue"
git push

echo
echo "Pushed. Migration 0122 already applied to the DB (connector). Verify the Vercel deploy for this SHA appears (KI677), then run the POST-DEPLOY LIVE QA above on North Star."
git rev-parse --short HEAD
