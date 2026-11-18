#!/bin/bash
# S817b: Send to Vacantless also copies the Quick replies answer. Signs the shared Shortcut and your own copy, tests, pushes.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
shortcuts sign --mode anyone --input shortcut-src/Send-to-Vacantless-unsigned.shortcut --output "public/shortcut/Send to Vacantless.shortcut"
shortcuts sign --mode anyone --input shortcut-src/Send-to-Vacantless-unsigned.shortcut --output public/shortcut/Send-to-Vacantless.shortcut
ls -la public/shortcut
npx tsc --noEmit -p .
npx tsx scripts/test-s816l-send-shortcut.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add app/api/shortcut/renter/route.ts lib/send-shortcut.ts lib/send-shortcut-server.ts lib/reply-kit-server.ts \
  app/dashboard/replies/page.tsx app/dashboard/replies/send-shortcut-card.tsx scripts/test-s816l-send-shortcut.ts \
  scripts/build-send-shortcut.py shortcut-src/Send-to-Vacantless-unsigned.shortcut \
  "public/shortcut/Send to Vacantless.shortcut" public/shortcut/Send-to-Vacantless.shortcut COMMIT-S817b-SHORTCUT-COPIES-REPLY.sh
git commit -m "S817b: Send to Vacantless copies the Quick replies answer

Noam 2026-11-18 used Send to Vacantless on Victor, then opened Quick replies
to answer him. Now one share does both: with ?v=2 the route answers in JSON
(line, reply, link) and the Shortcut copies reply. The reply is the Quick
replies text for that rental, the chat's site and the renter's question,
from one loader shared with the page (lib/reply-kit-server). A question with
no answer on file copies nothing (no guesses). Older Shortcuts keep the
plain line.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqHBdFvs17yuYwWkhZ"
git push origin main || git push origin main
echo "== app done"; git log --oneline -1

cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/_shortcut_personal"
shortcuts sign --mode people-who-know-me --input Send-to-Vacantless-Agile-unsigned.shortcut --output "Send to Vacantless.shortcut"
open "Send to Vacantless.shortcut"
echo "== your own Shortcut is open in Shortcuts: choose Replace if it asks."
