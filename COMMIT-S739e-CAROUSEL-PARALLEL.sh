#!/bin/bash
# S739e: Instagram carousel photos prepared in parallel (was ~40 s in Set Live).
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-instagram-carousel.ts
npx tsx scripts/test-instagram-graph.ts
npm run build
echo "== commit"
git add lib/instagram-graph.ts scripts/test-instagram-carousel.ts \
  COMMIT-S739e-CAROUSEL-PARALLEL.sh COMMIT-S739e-MESSAGE.txt
git commit -F COMMIT-S739e-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
