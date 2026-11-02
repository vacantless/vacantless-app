#!/bin/bash
# S742h: npm test runs every test script; GitHub Action runs tsc + all tests on main.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
node scripts/run-all-tests.mjs
echo "== commit"
git add scripts/run-all-tests.mjs scripts/tests-known-red.txt scripts/tests-needing-services.txt \
  .github/workflows/ci.yml package.json \
  COMMIT-S742h-TEST-GATE.sh COMMIT-S742h-MESSAGE.txt
git commit -F COMMIT-S742h-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
