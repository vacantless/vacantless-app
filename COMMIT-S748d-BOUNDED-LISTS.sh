#!/bin/bash
# S748d: rentals, viewings and reconcile stay right past 1,000 rows. Migration 0271 is applied.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-s748-bounded-lists.ts
echo "== commit"
git add app/dashboard/properties/page.tsx app/dashboard/showings/page.tsx app/dashboard/money/reconcile/page.tsx \
  supabase/migrations/0271_property_rollups_and_list_indexes.sql scripts/test-s748-bounded-lists.ts \
  COMMIT-S748d-BOUNDED-LISTS.sh COMMIT-S748d-MESSAGE.txt
git commit -F COMMIT-S748d-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
