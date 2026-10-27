#!/bin/bash
# S740a: comment-only fix on free Rentals.ca ads (robot renews them).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
echo "== commit"
git add lib/distribution-channels.ts COMMIT-S740a-RENTALS-COMMENT.sh COMMIT-S740a-MESSAGE.txt
git commit -F COMMIT-S740a-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
