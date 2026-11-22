#!/bin/bash
# S828a: the Glenrose fix list (pets, site rows say what is missing, touch-up
# scope, posting now on the Rentals row, Kijiji sign-up on kijiji.ca,
# Professional rentals' Kijiji fee).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s828-fixes.ts
npx tsx scripts/test-distribution-channels.ts
npx tsx scripts/test-rental-list-view.ts
npx tsx scripts/test-site-signup.ts
npx tsx scripts/test-add-property-v2.ts
npx tsx scripts/test-plain-language.ts
npx tsx scripts/test-helper-renew-wait.ts
node scripts/run-all-tests.mjs
git add "app/dashboard/properties/[id]/publish-everywhere.tsx" \
  "app/dashboard/properties/[id]/distribute-tab.tsx" \
  "app/dashboard/properties/[id]/page.tsx" \
  app/dashboard/properties/new/add-property-form.tsx \
  app/dashboard/properties/page.tsx \
  "app/dashboard/site-signin/[channel]/page.tsx" \
  lib/rental-list-view.ts lib/distribution-channels.ts \
  scripts/test-s828-fixes.ts scripts/test-helper-renew-wait.ts COMMIT-S828a-GLENROSE-FIXES.sh
git commit -m "S828a: what listing 50 Glenrose B showed was missing

Seen listing 50 Glenrose B on Davis (S827):
- Add rental never asked about pets; the site rows then said only
  \"Finish your listing first\". Pets (cats, dogs) now sit in their own
  section on Add rental, marked needed for rental sites, and each site row
  says what is missing (\"Needs: pet policy. Add it\").
- The touch-up box read as if it changed every photo. It now says it
  touches up the photos the folder brings in, not uploads.
- The Rentals row still offered \"Post to Kijiji\" while the robot was
  posting. A post under way now reads \"Posting to Kijiji\" (the same
  states the rental page calls Posting; an approved item untouched for an
  hour no longer counts), and the missing-site banner leaves it out.
- \"Make my Kijiji account\" never finishes in the secure window (KI1748).
  Kijiji now sends a new account to kijiji.ca's sign-up page, with the
  email to use, then back here to sign in.
- A rental listed by a real estate professional has no free Kijiji ad.
  The Kijiji row now says so, with the fee, and that it waits at Kijiji's
  checkout for the landlord (worker S828w posts it as Professional).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrErkpMczrKTEhuh7Z"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
