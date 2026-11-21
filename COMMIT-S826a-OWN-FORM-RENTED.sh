#!/bin/bash
# S826a: renters sent the account's own application form (Buildium) are not
# told "it rented" or closed as Lost; Sent line on the button; the email says
# which home to enter and drops the SIN promise for own forms.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s826a-own-form-sent.ts
npx tsx scripts/test-rented-notice.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/own-form-sent.ts lib/rented-notice.ts lib/rented-notice-server.ts lib/rental-application-server.ts lib/email.ts \
  "app/dashboard/leads/[id]/page.tsx" "app/dashboard/leads/[id]/application-card.tsx" \
  scripts/test-s826a-own-form-sent.ts scripts/test-rented-notice.ts scripts/test-s818b-own-application-form.ts COMMIT-S826a-OWN-FORM-RENTED.sh
git diff --cached --name-only
git commit -m "S826a: a renter sent your Buildium form is not told the unit rented

Sending an account's own application form (Buildium) does not move the
renter's stage, and Vacantless never hears when they apply there. Marking
the unit Rented then emailed \"it has been rented\" to the very renter who
applied in Buildium and closed them as Lost. Renters with an own-form send
note (and any row with the same email) are now left alone by the rented
notice.

Also, from an audit walked as a renter on Agile Unit 9:
- the renter page shows when the link was sent, and says to move the
  renter to Applied when it comes back;
- a phone-only send note says it was not emailed;
- the email says which home to enter, since Buildium's Desired Unit is a
  free text box, and no longer promises we never ask for a SIN (Buildium's
  form asks for one).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqZHG1ZVZ9Vv9rDpea"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
