#!/bin/bash
# S748e: ci green again (scope test knows the rentals rollup).
set -eo pipefail
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsx scripts/test-selected-org-dashboard-scope.ts | tail -1
npx tsx scripts/test-plain-language.ts | tail -1
echo "== commit"
git add scripts/test-selected-org-dashboard-scope.ts COMMIT-S748e-CI-SCOPE-TEST.sh COMMIT-S748e-MESSAGE.txt
git commit -F COMMIT-S748e-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
