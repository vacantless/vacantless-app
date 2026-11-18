#!/bin/bash
# S816e: phone book says what the alert and emergency numbers are for.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s816b-phone-book.ts
npx tsx scripts/test-plain-language.ts
git add app/dashboard/numbers/page.tsx scripts/test-s816b-phone-book.ts COMMIT-S816e-PHONE-BOOK-WORDS.sh
git commit -m "S816e: phone book says what the alert and emergency numbers are for

Noam 2026-11-18: new renters come by email and Agile's urgent repairs go
through the Buildium portal. The alert mobile is only the S762 sign-out
text, so the row is now Sign-out alert mobile; the emergency row says it
is only needed when tenants report repairs in Vacantless.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
