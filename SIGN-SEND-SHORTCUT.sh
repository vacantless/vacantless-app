#!/bin/bash
# S816o: signs the shared "Send to Vacantless" Shortcut (asks each landlord for their key) and ships it.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
mkdir -p public/shortcut
shortcuts sign --mode anyone --input shortcut-src/Send-to-Vacantless-unsigned.shortcut --output public/shortcut/Send-to-Vacantless.shortcut
ls -la public/shortcut
npx tsc --noEmit -p .
npx tsx scripts/test-s816l-send-shortcut.ts
npx tsx scripts/test-plain-language.ts
git add public/shortcut/Send-to-Vacantless.shortcut app/dashboard/replies/page.tsx app/dashboard/replies/send-shortcut-card.tsx lib/send-shortcut-copy.ts SIGN-SEND-SHORTCUT.sh
git commit -m "S816o: Get the Shortcut link on Quick replies

Send to Vacantless proven live 2026-11-18 on Agile: a Messenger screenshot
of the Unit 3 chat saved the renter on Unit 3 as Replied from Facebook
Marketplace. The shared Shortcut (asks for the key when added, signed for
anyone) now ships at /shortcut/Send-to-Vacantless.shortcut and Quick
replies links it instead of the build-it-yourself steps.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
