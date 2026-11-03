#!/bin/bash
# S747c: first rental sets the viewing time zone. Migration 0268 is applied
# to prod by Claude before this runs.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-booking-timezones.ts
echo "== commit"
git add supabase/migrations/0268_first_rental_sets_timezone.sql lib/timezone-label.ts \
  app/dashboard/availability/page.tsx app/dashboard/availability/actions.ts \
  scripts/test-booking-timezones.ts COMMIT-S747c-TIMEZONE.sh COMMIT-S747c-MESSAGE.txt
git commit -F COMMIT-S747c-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
