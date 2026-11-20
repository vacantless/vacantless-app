#!/bin/bash
# S824f: an arrival note for renters, and "Goes to" and "Includes" on every message row.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s824f-arrival-note.ts
npx tsx scripts/test-s824e-message-catalog.ts
npx tsx scripts/test-sms.ts
npx tsx scripts/test-sister-unit-fill.ts
npx tsx scripts/test-plain-language.ts --update-baseline
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0315_renter_arrival_note.sql lib/arrival-note.ts lib/email.ts lib/sms.ts lib/sister-unit-fill.ts lib/message-catalog.ts \
  "app/r/[propertyId]/actions.ts" "app/showing/offer/[token]/actions.ts" "app/showing/reschedule/[token]/actions.ts" \
  app/api/cron/reminders/route.ts app/dashboard/showings/actions.ts "app/dashboard/leads/[id]/book-actions.ts" \
  app/dashboard/properties/actions.ts "app/dashboard/properties/[id]/page.tsx" app/dashboard/automations/every-message/page.tsx \
  scripts/test-s824f-arrival-note.ts scripts/test-tenant-emergency.ts scripts/plain-language-baseline.json COMMIT-S824f-ARRIVAL-NOTE.sh
git commit -m "S824f: an arrival note for renters, and who gets each message

Renters got who to call on arrival, a map and a photo ID line, but not how
to get in. The buzzer and lockbox notes are the agent's, on purpose.

- Rental page, Showing instructions: a new Arrival note for renters, for
  example Buzz 20 at the front door. Park in the visitor spots. A box
  copies it to the other units at the address. A note that reads like a
  lockbox or door code is refused, so codes stay agent-only.
- Renters see it in the booking email and text, the day-before email,
  the day-of texts, and the new-time emails. Texts carry the first 120
  characters. Migration 0315: properties.renter_arrival_note (300 max),
  and get_booking_confirmation_extras returns arrival_note.
- Fixed: booking a viewing for a renter used the account's arrival phone
  and skipped the rental's own. The moved-viewing email now carries the
  arrival phone too.
- Every message we send: each row says who it goes to, and what it
  includes where that matters.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGq4W8hFu15eRRP3WoB"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
