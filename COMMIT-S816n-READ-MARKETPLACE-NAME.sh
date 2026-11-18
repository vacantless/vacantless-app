#!/bin/bash
# S816n: the screenshot read finds the renter's name on Marketplace chats, in any script.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-ai-screenshot-lead.ts
npx tsx scripts/test-s816l-send-shortcut.ts
npx tsx scripts/test-plain-language.ts
git add lib/ai-screenshot-lead.ts lib/send-shortcut-server.ts COMMIT-S816n-READ-MARKETPLACE-NAME.sh
git commit -m "S816n: screenshot read takes the Marketplace renter's name in any script

First live Send to Vacantless (Agile, Unit 3 chat) came back 'no name'.
The renter's name was in Punjabi script in the Marketplace title
'Name · 1 Bed 1 Bath Apartment' and 'Name started this chat'. The prompt
now says the title name is the renter, to copy names in any script, and
that a 'CA\$1,250' listing line matches the rental with that price. The
route logs which fields came back (never the values).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
