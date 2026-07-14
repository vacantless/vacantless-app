#!/usr/bin/env bash
# S425c - Lease-OCR Slice 1b: gate to Growth+ and cap monthly usage. Still DARK
# behind LEASE_OCR_ENABLED.
#
# WHY: lease-OCR carries a real per-use model cost (~2 cents/lease), so it is a
# paid feature with a runaway/abuse backstop (Noam, S425).
#
# WHAT IT ADDS:
#  - lib/billing.ts: new `lease_ocr` entitlement (Growth + Premium + pilot on;
#    Free/legacy off) + canUseLeaseOcr() + leaseOcrMonthlyCap() (Growth 25 /
#    Premium 100 per org per month). Mirrors the listing_marketing gate.
#  - migration 0111: lease_ocr_usage counter (per org, per YYYY-MM) + the
#    SECURITY DEFINER claim_lease_ocr_scan() atomic claim (membership-guarded,
#    counter writable ONLY through it). *** APPLY VIA SUPABASE CONNECTOR ***
#    (supabase/migrations/0111_lease_ocr_usage.sql) - safe now, table is empty
#    and the fn unused until the feature is enabled.
#  - actions.ts: the two extract actions are unified into ONE `extractLease`
#    that enforces manage_tenancies -> lease_ocr entitlement -> monthly cap
#    (claimed exactly once) before the model call. New "locked" / "limit"
#    LeaseParseResult reasons.
#  - New-Tenancy page + island: Free/legacy see the LOCKED upsell (never hidden);
#    the island shows clear messages for the locked + monthly-limit cases.
#
# tsc clean, eslint clean, no new em dashes. NO money surface (rent/billing rails
# untouched).
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

npx tsc --noEmit
npx tsx scripts/test-billing.ts
npx tsx scripts/test-lease-extract.ts
npx tsx scripts/test-lease-locator.ts
npx next lint \
  --file "lib/billing.ts" \
  --file "app/dashboard/tenancies/actions.ts" \
  --file "app/dashboard/tenancies/new/page.tsx" \
  --file "app/dashboard/tenancies/new/lease-upload-prefill.tsx"

git add \
  "lib/billing.ts" \
  "lib/lease-extract.ts" \
  "scripts/test-billing.ts" \
  "app/dashboard/tenancies/actions.ts" \
  "app/dashboard/tenancies/new/page.tsx" \
  "app/dashboard/tenancies/new/lease-upload-prefill.tsx" \
  "supabase/migrations/0111_lease_ocr_usage.sql"

git commit -m "S425c: gate lease-OCR to Growth+ and cap monthly usage (DARK)

New lease_ocr entitlement (Growth 25 / Premium 100 scans per org per month).
extractLease unifies the image+text paths into one guarded action that enforces
the entitlement and claims a monthly credit exactly once before the paid model
call (migration 0111 = lease_ocr_usage counter + SECURITY DEFINER
claim_lease_ocr_scan, membership-guarded, counter not user-writable). Free/legacy
see the locked upsell. tsc/eslint clean, billing + lease tests updated."

git push origin main
echo "Pushed. Apply migration 0111 via the Supabase connector. Feature stays DARK until LEASE_OCR_ENABLED=1."