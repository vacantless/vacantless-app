#!/bin/bash
# S832c: Canadian-dollar subtotal, Brighten on uploads, dark or blurry photo check (0323 already applied).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'export function monthlySubtotalCad' lib/vendor-costs.ts || { echo "STOP: S832c edit missing"; exit 1; }
grep -q 'export async function processUploadedPhoto' lib/photo-touchup-upload-server.ts || { echo "STOP: S832c upload edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s832-vendor-costs.ts
npx tsx scripts/test-s832c-photo-quality.ts
node scripts/run-all-tests.mjs
git add lib/vendor-costs.ts components/vendor-cost-table.tsx scripts/test-s832-vendor-costs.ts lib/photo-quality.ts lib/photo-quality-server.ts lib/photo-touchup-upload-server.ts supabase/migrations/0323_photo_quality_flag.sql app/dashboard/properties/actions.ts "app/dashboard/properties/[id]/photo-manager.tsx" "app/dashboard/properties/[id]/page.tsx" lib/drive-import-server.ts lib/dropbox-import-server.ts scripts/test-s832c-photo-quality.ts scripts/test-property-photo-upload.ts COMMIT-S832c-SUBTOTAL-UPLOAD-TOUCHUP-PHOTO-CHECK.sh
git diff --cached --name-only
git commit -m "S832c: CAD subtotal, Brighten on uploads, dark or blurry photo check

Pays-for-itself table: one Canadian-dollar price per line (US prices at the
dated Bank of Canada rate, vendor price kept under it), a subtotal for the
monthly apps beside Starter, and one worked example on the photo line.
Per-job lines are never summed or averaged.

Uploads: a Brighten these photos switch, on by default. The upload is kept
as the original and the brightened copy is shown, so Use the originals
works as for folder pulls.

Photo check: uploads and Drive or Dropbox pulls are measured (95th
percentile brightness under 110, Laplacian variance under 60 at 512 px,
calibrated on 50 live photos with no false flags). A flagged photo shows
Looks dark or Looks blurry, with one line above the photos. Migration 0323
(applied) adds property_photos.quality_flag.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGoZLAxBr3cq3Dgcj6r"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
