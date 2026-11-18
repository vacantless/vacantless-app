#!/bin/bash
# S816c: help videos match the page and the picture. Run after S816a and S816b.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-page-help.ts
npx tsx scripts/test-friction-pages.ts
git add public/videos/howto-1.jpg public/videos/howto-2.jpg public/videos/howto-3.jpg public/videos/howto-4.jpg \
  public/videos/howto-5.jpg public/videos/howto-6.jpg public/videos/howto-7.jpg public/videos/howto-8.jpg \
  public/videos/howto-9.jpg public/videos/howto-10.jpg \
  lib/how-to-videos.ts lib/page-help.ts components/page-help.tsx app/how-to/page.tsx "app/fix/[slug]/page.tsx" \
  scripts/test-page-help.ts COMMIT-S816c-HELP-VIDEOS.sh COMMIT-S816c-MESSAGE.txt
git commit -F COMMIT-S816c-MESSAGE.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
