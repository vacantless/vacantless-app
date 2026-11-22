#!/bin/bash
# S828c: "When can you come?" on request-only rentals, and "I book each viewing myself".
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s828c-viewing-request.ts
npx tsx scripts/test-lead-no-suitable-time.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/viewing-request.ts lib/rental-readiness.ts lib/share-readiness.ts \
  "app/r/[propertyId]/inquiry-form.tsx" "app/r/[propertyId]/actions.ts" \
  app/dashboard/properties/page.tsx "app/dashboard/properties/[id]/page.tsx" app/dashboard/page.tsx \
  app/dashboard/availability/page.tsx app/dashboard/availability/actions.ts \
  app/api/cron/availability-tripwire/route.ts \
  supabase/migrations/0318_viewings_by_request.sql \
  scripts/test-s828c-viewing-request.ts scripts/test-lead-no-suitable-time.ts \
  COMMIT-S828c-VIEWINGS-BY-REQUEST.sh
git commit -m "S828c: when can you come, and I book each viewing myself

Noam books every viewing himself (no open calendar) and often hands it to a
showing agent; MLS showings go through BrokerBay. Vacantless kept telling him
to set viewing times, and a request told him only that no times were open.

- A rental with no open times asks the renter \"When can you come?\": five
  pills (weekday daytime, weekday evening, Saturday, Sunday, any time) and an
  optional short line. It is kept on the renter's notes and named in the
  new-request email (\"They can come: Weekday evening, Saturday.\").
- Viewings has one switch, \"I book each viewing myself\" (organizations.
  viewings_by_request, migration 0318, off by default). With it on: the
  Rentals row and detail page stop asking for viewing times, the Today card
  and the viewings empty state stop saying \"Set viewing times\", the
  times-ran-out email skips the account, and the request email does not say
  \"open your times\".

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrErkpMczrKTEhuh7Z"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
