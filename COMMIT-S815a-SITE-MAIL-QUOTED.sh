#!/bin/bash
# S815a: a rental site's email with a quoted sender check is passed on.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'S815: some mail servers quote the value' lib/portal-senders.ts || { echo "STOP: S815a edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-site-mail-pass.ts
npx tsx scripts/test-portal-senders.ts
npx tsx scripts/test-portal-lead-ingest.ts
git add lib/portal-senders.ts scripts/test-site-mail-pass.ts COMMIT-S815a-SITE-MAIL-QUOTED.sh COMMIT-S815a-MESSAGE.txt
git commit -F COMMIT-S815a-MESSAGE.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
