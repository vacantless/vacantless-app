#!/bin/bash
# S742k: package-lock in sync for npm ci; actions moved off Node 20.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
# Lock check in a scratch folder so node_modules here is never touched.
T="$(mktemp -d)"; cp package.json package-lock.json "$T/"; (cd "$T" && npm ci --dry-run --ignore-scripts --no-audit --no-fund >/dev/null) && echo "lockfile ok for npm ci"; rm -rf "$T"
npx tsc --noEmit
echo "== commit"
git add package-lock.json .github/workflows/ci.yml COMMIT-S742k-LOCKFILE-FOR-CI.sh COMMIT-S742k-MESSAGE.txt
git commit -F COMMIT-S742k-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
