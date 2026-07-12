#!/usr/bin/env bash
# S475 - Fold Codex's S474b review (concierge "Publish for me" queue). CODE ONLY -
# NO migration, NO DB schema change (0139 already applied + live). Three P2s;
# S474 confirmed closed by Codex (no remaining renter-facing showing_instructions).
#
# Findings folded (Codex S474/S474b pass, 3x P2, 0 P1):
#   P2#1 (multi-org authZ)  app/dashboard/properties/actions.ts requestConciergePublish
#        checked role/plan against getCurrentOrg() (an arbitrary .limit(1) org) while
#        RLS returns run items from ANY org in user_org_ids(). A multi-org user could
#        spend a paid/privileged org's plan+role to unlock concierge for a different
#        free/lower-role org's run. FIX: derive organization_id from the run, then
#        re-check role (new getRoleForOrg, org-scoped membership) + the
#        listing_marketing entitlement for THAT exact org.
#   P2#2 (cross-org listing_post integrity)  app/dashboard/admin/concierge-actions.ts
#        completeConciergeItem trusted the denormalized distribution_run_items
#        .listing_post_id under service-role and updated listing_posts by id only (a
#        stale/corrupt FK could overwrite another property/org's post URL), and marked
#        the item live even if the tracker insert/update failed. FIX: validate the FK
#        against the run-derived org+property+portal (discard if it doesn't match),
#        pin every listing_posts write to org+property+portal, error-check each write
#        (?err=trackfail), and require a live tracker before marking a portal item live.
#   P2#3 (non-atomic desk mutations)  concierge-actions.ts claim/complete/reject
#        updated by id only, so stale forms / two-staff double-clicks could re-open a
#        live item or double-post. FIX: every mutation now carries mode='concierge' +
#        open-status predicates (claim also requires concierge_claimed_by IS NULL),
#        selects the affected rows, and redirects ?err=stale when 0 rows match
#        (Postgres re-evaluates the WHERE against the committed row = atomic).
#
# Gates (run on device this session):
#   - node node_modules/typescript/bin/tsc --noEmit : clean (EXIT 0)
#   - node_modules/.bin/eslint <3 touched files>     : clean (EXIT 0)
#   Run on Mac before push (native binaries unavailable in the Linux device VM):
#   - node_modules/.bin/tsx scripts/test-distribution-concierge.ts  (expect 60/0;
#     canRequestConcierge/pure logic untouched, so this is a regression confirm)
#   - npm run build  (next build / swc; KI741 - gate on the real build)
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
git rev-parse --is-inside-work-tree >/dev/null

# Mac-only gates (skip on failure so you SEE them; do not push if either is red).
node_modules/.bin/tsx scripts/test-distribution-concierge.ts
npm run build

# EXPLICIT git add of exactly the intended files (KI741 - never blanket add;
# there is concurrent uncommitted WIP in the tree).
git add \
  app/dashboard/properties/actions.ts \
  app/dashboard/admin/concierge-actions.ts \
  lib/membership.ts \
  DEPLOY-S475-CONCIERGE-CODEX-FOLDS.sh

git commit -m "S475: fold Codex S474b P2s - concierge multi-org authZ, listing_post integrity, atomic desk mutations"
git push

echo
echo "Pushed. NO migration. Verify the Vercel deploy for this SHA is READY + aliased app.vacantless.com (KI677)."
git rev-parse --short HEAD
