#!/bin/bash
# S816d: phone book shows your texting number and the whole list.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s816b-phone-book.ts
npx tsx scripts/test-plain-language.ts
git add app/dashboard/numbers/page.tsx app/dashboard/numbers/phone-search.tsx scripts/test-s816b-phone-book.ts COMMIT-S816d-PHONE-BOOK-FIX.sh
git commit -m "S816d: phone book shows your texting number and the whole list

Read live on Agile after S816b: the texting number said Not set though
Agile has 226-798-0746 (org_sms_numbers is service-role only, so the
signed-in read came back empty; now through orgOwnSmsNumber), and the
list stopped at 200 of 229 before any search (now all, 300 when searching).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
