#!/bin/bash
# S820d: own-form accounts get the free LTB check and no dead Offer box. S820e: Rented marks the accepted-offer renter Leased.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s820de-own-form-lease-winner.ts
npx tsx scripts/test-s818b-own-application-form.ts
npx tsx scripts/test-unit-progress.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add "app/dashboard/leads/[id]/application-card.tsx" app/dashboard/properties/actions.ts lib/unit-progress-server.ts \
  lib/lease-winner.ts lib/lease-winner-server.ts scripts/test-s820de-own-form-lease-winner.ts COMMIT-S820de-OWN-FORM-LEASE-WINNER.sh
git commit -m "S820d+e: Buildium accounts get the LTB check; Rented marks the offer signer Leased

S820d: an account that sends its own application form (Agile on Buildium)
now has \"Check LTB orders (free)\" on the renter page, to check a name
before approving in Buildium, and no longer sees an Offer box that could
never be used (it waited for an application signed in Vacantless).

S820e: when a unit is marked Rented (the crew's tap or the landlord's Leased
save), the renter who signed the accepted offer in Vacantless moves to
Leased, before anyone is told it rented. Only that case: being sent an
application is not proof, since on a Buildium account the real tenant may
never have been a renter here.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqpaWNL7tNvrXegHrw"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
