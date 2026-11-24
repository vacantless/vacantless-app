#!/bin/bash
# S839a (REVIEW-S839 steps A, B, C): server beside the database, a loading
# screen on every dashboard tap, resized photos on the public rental page.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q '"yul1"' vercel.json || { echo "STOP: S839 region edit missing"; exit 1; }
grep -q "sizedPhotoUrl(cover, PHOTO_WIDTH_COVER)" "app/r/[propertyId]/photo-gallery.tsx" || { echo "STOP: S839 gallery edit missing"; exit 1; }
test -f app/dashboard/loading.tsx || { echo "STOP: S839 loading screen missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s839-photo-size.ts
node scripts/run-all-tests.mjs
git add vercel.json app/dashboard/loading.tsx lib/photo-size.ts \
  "app/r/[propertyId]/photo-gallery.tsx" scripts/test-s839-photo-size.ts \
  COMMIT-S839a-MONTREAL-LOADING-PHOTOS.sh
git --no-pager diff --cached --name-only
git commit -m "S839a: server in Montreal, loading screen on every tap, resized rental photos

REVIEW-S839 steps A, B and C.
- vercel.json regions yul1: the code ran in Washington (iad1) while the
  database is in Montreal (ca-central-1), so every query crossed the border.
- app/dashboard/loading.tsx: a tap on any dashboard link showed nothing for
  0.5 to 4 seconds; a loading screen now shows at once.
- Public rental page: photos were sent at camera size (10 photos, 22.7 MB on
  50 Glenrose). The gallery now asks Supabase for 1280 px (cover), 480 px
  (grid, lazy-loaded) and 1920 px (full view), and falls back to the
  original if a resized copy fails (lib/photo-size.ts).

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrF59iM2qiBS4Uh8MK"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
