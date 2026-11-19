#!/bin/bash
# S820f: how-to 11 (Application to offer) and how-to 12 (From your phone) on the site and in page help.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-page-help.ts
npx tsx scripts/test-friction-pages.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add public/videos/howto-11.mp4 public/videos/howto-11.jpg public/videos/howto-12.mp4 public/videos/howto-12.jpg \
  lib/how-to-videos.ts lib/page-help.ts scripts/test-page-help.ts COMMIT-S820f-HOWTO-11-12.sh
git commit -m "S820f: two new how-to videos, Application to offer and From your phone

How-to 11 walks the renter from Send application to a signed offer: the
renter's form, a co-applicant, the free LTB check, Ask for credit check, and
the offer both sign. How-to 12 shows Send to Vacantless from a phone: a chat
screenshot, Share, the renter saved and the reply copied. Filmed on the
Lakeview test account with made-up renters; every frame checked for real
email addresses. The renter page's ? opens 11 after 3; Renters, Quick
replies and Captures open 12.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqpaWNL7tNvrXegHrw"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
