#!/bin/bash
# S822b: unit progress cards say where the ads are live; S822c: names and addresses
# left out of Chrome's translator on Viewings, tenancies and Quick replies.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-unit-progress.ts
npx tsx scripts/test-s821b-start-here-android-share.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/unit-progress.ts lib/unit-progress-server.ts "app/crew/[token]/page.tsx" app/dashboard/crew/page.tsx scripts/test-unit-progress.ts COMMIT-S822b-ADVERTISED-NOTRANSLATE.sh
git commit -m "S822b: unit progress says where the ads are live

Narayan's page showed 833 Pillette Unit 36 as 'Photos are in' (Xavier,
Nov 16) while its ads were live on Rentals.ca, Zumper and Marketplace,
because nobody tapped Ready to post. Each unit card on the crew link and
the landlord's Unit progress page now says 'Advertised on ...' from the
unit's live ads, so the page cannot read unposted when it is posted. No
new tap and no stage change; rented units show no line.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGokZ73XK4onn62KW9a"
git add app/dashboard/showings/page.tsx app/dashboard/tenancies/page.tsx "app/dashboard/tenancies/[id]/page.tsx" app/dashboard/replies/reply-kit.tsx scripts/test-s821b-start-here-android-share.ts
git commit -m "S822c: names and addresses not translated on the remaining screens

S821e kept Chrome's translator off renter names and rental addresses on the
rental page, renter page, Rentals list and renter queue. The Viewings list,
the tenancies list and tenancy page, and the Quick replies cards still let
it rewrite them. They are now marked not to translate too. The Today page
shows counts only and needed nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGokZ73XK4onn62KW9a"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
