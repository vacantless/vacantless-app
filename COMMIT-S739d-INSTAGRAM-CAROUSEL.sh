#!/bin/bash
# S739d: Instagram carousel (up to five photos per post).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-instagram-carousel.ts
npx tsx scripts/test-instagram-graph.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add lib/instagram-graph.ts app/dashboard/properties/distribution-actions.ts scripts/test-instagram-carousel.ts \
  COMMIT-S739d-INSTAGRAM-CAROUSEL.sh COMMIT-S739d-MESSAGE.txt
git commit -F COMMIT-S739d-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
