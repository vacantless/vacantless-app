#!/bin/bash
# S823c + S823d: offer viewing times to a renter, and read Realtor.ca enquiry emails.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-viewing-offers.ts
npx tsx scripts/test-realtor-ca-lead.ts
npx tsx scripts/test-portal-senders.ts
npx tsx scripts/test-portal-inbox.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0312_viewing_offers.sql supabase/migrations/0313_inbound_portal_events_realtor_ca.sql lib/viewing-offers.ts lib/email.ts lib/portal-senders.ts lib/portal-inbox.ts lib/portal-lead-email.ts lib/portal-lead-ingest-server.ts "app/dashboard/leads/[id]/offer-times-actions.ts" "app/dashboard/leads/[id]/page.tsx" "app/showing/offer/[token]/page.tsx" "app/showing/offer/[token]/actions.ts" scripts/test-viewing-offers.ts scripts/test-realtor-ca-lead.ts COMMIT-S823c-OFFER-TIMES-REALTOR-CA.sh
git commit -m "S823c+d: offer times to a renter, and read Realtor.ca enquiries

Built for an agent with a rental listing (251 Manitoba, Davis Muscovitch
Rentals), who does not want an open or an empty calendar on show.

S823c, Offer times to this renter (renter page, Viewings):
- The landlord picks up to three times. The renter gets an email, or a
  message the landlord copies into any chat, with a link that shows only
  those times. The one they tap is booked and confirmed right away.
- No calendar is shown and no viewing hours need to be open. Nothing is
  held until the renter taps. A new offer replaces the old one, and an
  offer can be withdrawn.
- Migration 0312: viewing_offers, get_viewing_offer, accept_viewing_offer.

S823d, Realtor.ca enquiry emails:
- noreply@leads.realtor.ca joins the trusted site senders, read off a real
  message (DKIM d=leads.realtor.ca, DMARC pass, Reply-To is the enquirer).
- The reader takes the name, email, phone, message, preferred time and MLS
  number, and matches the subject's address to one rental in the account.
- An enquiry that matches no rental (a sale listing) is not filed.
- Migration 0313: the site event log accepts realtor_ca.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGngsKqF4sZh6eWxsjC"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
