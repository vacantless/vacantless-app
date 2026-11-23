#!/bin/bash
# S832b + S832c in one commit (the S832b script stopped on tests; nothing was pushed).
# Migrations 0322, 0323, 0324 are already applied.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'otherRobotRentals' lib/billing.ts || { echo "STOP: S832b edit missing"; exit 1; }
grep -q 'export function monthlySubtotalCad' lib/vendor-costs.ts || { echo "STOP: S832c edit missing"; exit 1; }
npx tsc --noEmit -p .
node scripts/run-all-tests.mjs
git add lib/billing.ts lib/robot-posting-access.ts supabase/migrations/0322_every_account_one_robot_rental.sql supabase/migrations/0324_robot_rental_in_progress.sql scripts/test-billing.ts scripts/test-posting-addon.ts app/page.tsx app/compare/showinghero/page.tsx \
  lib/vendor-costs.ts components/vendor-cost-table.tsx scripts/test-s832-vendor-costs.ts lib/photo-quality.ts lib/photo-quality-server.ts lib/photo-touchup-upload-server.ts supabase/migrations/0323_photo_quality_flag.sql app/dashboard/properties/actions.ts "app/dashboard/properties/[id]/photo-manager.tsx" "app/dashboard/properties/[id]/page.tsx" lib/drive-import-server.ts lib/dropbox-import-server.ts scripts/test-s832c-photo-quality.ts scripts/test-property-photo-upload.ts scripts/test-s828-fixes.ts \
  COMMIT-S832b-ONE-ROBOT-RENTAL-EVERY-PLAN.sh COMMIT-S832c-SUBTOTAL-UPLOAD-TOUCHUP-PHOTO-CHECK.sh COMMIT-S832bc-ROBOT-RENTAL-PHOTOS-SUBTOTAL.sh
git diff --cached --name-only
git commit -m "S832b+c: one free robot rental on every plan, Brighten on uploads, photo check, CAD subtotal

S832b: every account gets one rental posted to Kijiji, Rentals.ca and Zumper
by the robot, so moving from Free to a paid plan never takes posting away.
The free one is the rental with live robot-site ads, or a robot post already
under way, or the one being posted. Posting covers the rest. SQL twins 0322
and 0324 (applied).

S832c: uploads get a Brighten these photos switch, on by default, original
kept. Uploads and folder pulls are checked for dark or blurry photos
(calibrated on 50 live photos, no false flags; 0323 applied). The
pays-for-itself table shows Canadian dollars at the dated Bank of Canada
rate, a monthly-apps subtotal beside Starter, and one worked photo example.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGoZLAxBr3cq3Dgcj6r"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
