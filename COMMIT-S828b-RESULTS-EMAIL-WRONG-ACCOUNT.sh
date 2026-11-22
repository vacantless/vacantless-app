#!/bin/bash
# S828b: the "is live on N sites" email, and a rental the current login cannot open.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s828-fixes.ts
npx tsx scripts/test-posted-results-email.ts
npx tsx scripts/test-plain-language.ts
npx tsx scripts/test-s716-login-next.ts
node scripts/run-all-tests.mjs
git add lib/posted-results-email.ts scripts/test-posted-results-email.ts \
  "app/dashboard/properties/[id]/page.tsx" app/auth/signout/route.ts \
  scripts/test-s828-fixes.ts COMMIT-S828b-RESULTS-EMAIL-WRONG-ACCOUNT.sh
git commit -m "S828b: the live-on-sites email, and a rental in another account

Noam's email for 50 Glenrose B (2026-11-21, 8:01 pm):
- It said \"Want more renters? Add Facebook Marketplace\" though the ad was
  up. Vacantless knows a Marketplace ad only once its link is saved
  (KI1750), so the email now covers both: not on Marketplace yet, here is
  the link; already posted, paste the ad's link on the rental.
- The Zumper line was the owner's manage page, which asks for a Zumper
  sign-in. It is now the public ad (the S773 rule the Rentals list uses).
- \"Open your rental\" opened on a phone signed in to the demo account
  (Lakeview Rentals) and showed a bare not-found page. A rental the
  current login cannot open now says which account this is (the demo, or
  the email), with \"Sign in with another account\" that signs out and
  comes back to the rental after the new sign-in (/auth/signout takes a
  safe next=).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrErkpMczrKTEhuh7Z"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
