#!/bin/bash
# S747b: how-to video 4 re-take. No migration.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
echo "== commit"
git add public/videos/howto-4.mp4 public/videos/howto-4.jpg lib/how-to-videos.ts \
  COMMIT-S747b-HOWTO-4.sh COMMIT-S747b-MESSAGE.txt
git commit -F COMMIT-S747b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
