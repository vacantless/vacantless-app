#!/bin/bash
# S816m: the Shortcut sends the picture as the body with the key in a header; grants for keys; then signs your Shortcut.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s816l-send-shortcut.ts
npx tsx scripts/test-plain-language.ts
git add app/api/shortcut/renter/route.ts lib/send-shortcut.ts scripts/test-s816l-send-shortcut.ts scripts/build-send-shortcut.py \
  shortcut-src/Send-to-Vacantless-unsigned.shortcut supabase/migrations/0307_capture_keys_grants.sql COPY-SQL-0307.sh \
  SIGN-SEND-SHORTCUT.sh COMMIT-S816m-SHORTCUT-FILE.sh
git commit -m "S816m: Send to Vacantless takes the picture as the body; key table grants

macOS refused to sign the first Shortcut file (its form field for the
picture had the wrong shape). The Shortcut now sends the picture as the
request body with Authorization: Bearer <key>; the route reads either that
or the form, and works out JPEG or PNG from the first bytes when the type
is missing. 0307 grants the service role read and write on capture_keys
(this project gives new tables no default grants; key making failed
without it). scripts/build-send-shortcut.py writes the shared Shortcut with
a question for the key; SIGN-SEND-SHORTCUT.sh signs it on a Mac.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== pushed"; git log --oneline -1
bash "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/_shortcut_personal/SIGN.sh"
