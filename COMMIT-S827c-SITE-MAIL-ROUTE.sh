#!/bin/bash
# S827c: a rental site's account mail reaches the pass-on, not the capture drop.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-inbound-postmark-dispatch.ts
npx tsx scripts/test-site-mail-pass.ts
npx tsx scripts/test-portal-lead-ingest.ts
node scripts/run-all-tests.mjs
git add lib/inbound-postmark-dispatch.ts scripts/test-inbound-postmark-dispatch.ts COMMIT-S827c-SITE-MAIL-ROUTE.sh
git commit -m "S827c: pass on a rental site's account mail instead of dropping it

Seen making a new Kijiji account on the Davis Vacantless address: Kijiji's
activation email arrived at 16:53 and was dropped as a loop. It reads like
neither a renter lead nor an enquiry, so the dispatcher sent it to the
capture path, which has no site-mail pass-on (S806b lives on the lead
path). Kijiji then refused the sign-in: account not verified.

Mail from a rental site's domain (kijiji.ca, rentals.ca, zumper.com,
zumperchat.com, padmapper.com) now goes to the lead path, where aligned
authentication is checked and the mail is passed on to the owner (and a
confirm link opened). A landlord's receipt stays on the capture path; a
look-alike domain is not site mail.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGmkHg5MoubAxfPMx8c"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
