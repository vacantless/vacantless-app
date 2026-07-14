#!/usr/bin/env bash
# S425 - Lease-OCR Slice 1: upload a signed lease PDF -> pre-filled draft tenancy.
#
# Ships DARK behind LEASE_OCR_ENABLED (do NOT set it until the synthetic-lease QA
# on North Star passes). The New-Tenancy page only renders the uploader when
# LEASE_OCR_ENABLED=1; the model call additionally needs ANTHROPIC_API_KEY.
#
# WHAT IT DOES:
#  - lib/lease-extract.ts (PURE): the LeaseDraft contract + prompt + normalizer +
#    the 3-layer PII redaction guard (SIN/SSN/card/bank/licence/DOB all stripped
#    to null; names/emails/phones allowed). 80/0 unit tests.
#  - lib/lease-extract-vision.ts (IMPURE): the Anthropic Messages call, never-
#    throws {ok:false,reason} union, ASCII-key guard (KI555), text + image paths.
#  - app/dashboard/tenancies/actions.ts: extractLeaseFromText server action
#    (manage_tenancies-guarded, org-scoped, returns the draft; no PII in any URL).
#  - app/dashboard/tenancies/new/lease-upload-prefill.tsx: client island - reads
#    the first 8 pages of the lease PDF ON-DEVICE with pdfjs (same as the MLS
#    import), calls the action, pre-fills the form fields + a review panel.
#  - app/dashboard/tenancies/new/page.tsx: renders the island when LEASE_OCR_ENABLED=1.
#
# NO migration. NO money surface. The lease bytes are never uploaded/stored; only
# the extracted text goes to the model transiently (Layer 3). tsc clean, eslint
# clean, no new em dashes.
#
# Docs (committed): LEASE-OCR-EXTRACTION-SPEC-2026-07-06.md,
# RENT-INCREASE-LOOP-GAPS-2026-07-06.md
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

npx tsc --noEmit
npx tsx scripts/test-lease-extract.ts
npx next lint \
  --file "lib/lease-extract.ts" \
  --file "lib/lease-extract-vision.ts" \
  --file "app/dashboard/tenancies/actions.ts" \
  --file "app/dashboard/tenancies/new/lease-upload-prefill.tsx" \
  --file "app/dashboard/tenancies/new/page.tsx"

git add \
  "lib/lease-extract.ts" \
  "lib/lease-extract-vision.ts" \
  "scripts/test-lease-extract.ts" \
  "app/dashboard/tenancies/actions.ts" \
  "app/dashboard/tenancies/new/lease-upload-prefill.tsx" \
  "app/dashboard/tenancies/new/page.tsx" \
  "LEASE-OCR-EXTRACTION-SPEC-2026-07-06.md" \
  "RENT-INCREASE-LOOP-GAPS-2026-07-06.md"

git commit -m "S425: lease-OCR Slice 1 - upload a lease to pre-fill a draft tenancy (DARK)

Upload a signed lease PDF on the New-Tenancy page; pdfjs extracts the first 8
pages on-device, the extractLeaseFromText action reads them into a PII-guarded
LeaseDraft, and the form pre-fills for the operator to confirm. 3-layer PII
posture: prompt refuses SIN/DL/bank/card/DOB; normalizer strips them regardless;
lease bytes never stored. Pure contract + 80/0 tests. Ships DARK behind
LEASE_OCR_ENABLED (unset). No migration, no money surface. tsc/eslint clean."

git push origin main
echo "Pushed. Feature stays DARK until you set LEASE_OCR_ENABLED=1 in Vercel (after QA)."
