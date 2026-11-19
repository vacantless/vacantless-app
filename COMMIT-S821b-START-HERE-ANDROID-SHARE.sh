#!/bin/bash
# S821b: a short "Do these first" path on Getting started, and Android "Share to Vacantless" (no Shortcut, no key).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s821b-start-here-android-share.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/onboarding-wizard.ts lib/share-target.ts lib/send-shortcut-server.ts lib/reply-kit-server.ts \
  app/manifest.ts app/dashboard/replies/shared/route.ts app/dashboard/replies/page.tsx \
  app/dashboard/replies/send-shortcut-card.tsx app/dashboard/getting-started-card.tsx \
  "app/dashboard/(wizard)/getting-started/page.tsx" scripts/test-s821b-start-here-android-share.ts \
  COMMIT-S821b-START-HERE-ANDROID-SHARE.sh
git commit -m "S821b: a short first path on Getting started, and Android Share to Vacantless

Getting started showed nine steps at once. It now opens with Do these first
(add a rental, viewing times, one site, Set Live) and counts only those until
the first ad is up; the rest sit under Later, when you are ready. The connect
step says one site is enough. Paid accounts see a line to invite a family
member or friend to set it up with them.

Android had no way to send a chat screenshot. The installed app now shows in
Android's Share menu (manifest share_target). The share posts to
/dashboard/replies/shared with the landlord's own sign-in, so there is no
Shortcut and no key. It saves the renter the same way the iPhone Shortcut
does and shows the Quick replies answer with a Copy button. Not yet tried on
a real Android phone.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGnZ7VZEKhJ4sootXz7"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
