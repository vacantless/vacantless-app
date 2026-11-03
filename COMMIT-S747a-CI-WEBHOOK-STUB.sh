#!/bin/bash
# S747a: test-only fix for ci run 13. No migration, no product code.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-stripe-webhook.ts
npx tsx scripts/test-referral-credit.ts
echo "== commit"
git add scripts/test-stripe-webhook.ts COMMIT-S747a-CI-WEBHOOK-STUB.sh COMMIT-S747a-MESSAGE.txt
git commit -F COMMIT-S747a-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
