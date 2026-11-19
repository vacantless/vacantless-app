#!/bin/bash
# S820a: "Did you mean gmail.com?" on the inquiry form, and fix-and-resend on the renter page.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s820a-email-typo.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/email-typo.ts "app/r/[propertyId]/inquiry-form.tsx" app/dashboard/leads/actions.ts \
  "app/dashboard/leads/[id]/page.tsx" scripts/test-s820a-email-typo.ts COMMIT-S820a-EMAIL-TYPO-RESEND.sh
git commit -m "S820a: catch email typos, and resend the reply after a bounce

Victor (Agile, 1551 Assumption Unit 9) typed chidoh381@gmail.comc on the
inquiry form, so the welcome reply bounced and he never heard back. The
inquiry form now says \"Did you mean gmail.com?\" with a one-tap fix for
common slips (.comc, .con, gmial, hotmal, yaho and friends; real domains
like mail.com and ymail.com are left alone). When a reply bounces, or the
address on a renter looks mistyped, the renter page offers \"Save and send
the reply again\": it fixes the address and sends the same welcome reply,
with the booking page when there are open times.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqpaWNL7tNvrXegHrw"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
