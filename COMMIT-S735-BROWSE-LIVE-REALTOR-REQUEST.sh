#!/bin/bash
# S735: the public browse pages go live (migration 0257 applied, env
# BROWSE_SURFACE_ENABLED=true saved in Vercel), and Realtor.ca returns as a
# request a person answers (migration 0258 applied), never a site tile.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-brokerage-request.ts
npx tsx scripts/test-listing-seo.ts
npx tsx scripts/test-browse-surface.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add supabase/migrations/0257_browse_listed_and_fresh.sql \
  supabase/migrations/0258_brokerage_requests.sql \
  lib/org.ts lib/brokerage-request.ts lib/brokerage-request-email.ts \
  app/dashboard/settings/actions.ts app/dashboard/settings/page.tsx \
  "app/dashboard/properties/[id]/brokerage-actions.ts" \
  "app/dashboard/properties/[id]/brokerage-request-card.tsx" \
  "app/dashboard/properties/[id]/publish-everywhere.tsx" \
  "app/dashboard/properties/[id]/distribute-tab.tsx" \
  "app/dashboard/properties/[id]/page.tsx" \
  scripts/test-brokerage-request.ts scripts/test-plain-language.ts \
  scripts/plain-language-baseline.json \
  COMMIT-S735-BROWSE-LIVE-REALTOR-REQUEST.sh
git commit -m "S735: browse pages live for real rentals; Realtor.ca as a partner-agent request

Browse (/rentals, /rentals/[city], sitemap): built dark in S535, on now.
Before the flip the payload held four of our test accounts and a July
rental nobody had touched. Migration 0257 adds organizations.browse_listed
(default on, off for our five test accounts, a Settings checkbox under
contact details) and the RPC shows only fresh rentals: a live ad, an
inquiry in 45 days, or added or available within 45 days. Read live after
the migration: Agile's five Windsor units and 251 Manitoba, nothing else.

Realtor.ca (S710 decision: a brokerage request, never a tile): a card
under the site list, Ontario route (partner agent lists it on the MLS)
or local-agent route by province; a short form; migration 0258
brokerage_requests; the admins get the email; the card then says when
they asked and where we will reach them. Copy from the S585 routes the
broker approved in principle; the fee stays on the brokerage rail.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017xAx92wUE4EGqDc8joCS9Z"
git push origin main
echo "== done"; git log --oneline -1
