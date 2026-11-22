#!/bin/bash
# S829h: Send to Vacantless saves the renter again, and finds rentals in every account you manage.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'sendOrgIds' lib/send-shortcut-server.ts || { echo "STOP: S829h edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s829h-leads-generated-phone.ts
node scripts/run-all-tests.mjs
git add lib/send-shortcut-server.ts lib/ai-enquiry-ingest.ts app/dashboard/leads/screenshot-actions.ts app/api/shortcut/renter/route.ts \
  scripts/test-s829h-leads-generated-phone.ts scripts/test-chat-leads.ts COMMIT-S829h-SHORTCUT-SAVE.sh
git commit -m "S829h: Send to Vacantless saves the renter, across every account you manage

Noam's Marketplace chat for 50 Glenrose B kept answering 'Something went
wrong and the renter was not saved'. Two causes. The save wrote
leads.phone_e164, a generated column, so every save that reached that
insert failed (also the in-app screenshot upload and the email enquiry
fallback). And the Shortcut key was made in Agile while the rental is in
Davis Muscovitch Rentals, so the rental was never found. The Shortcut
now looks in every account the person can add renters in and saves the
renter in the account that owns the rental. A failed save is now logged.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGorzZRkyX89r57Su5V"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
