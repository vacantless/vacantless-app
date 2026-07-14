#!/usr/bin/env bash
# S425b - Lease-OCR Slice 1a: LOCATE the lease inside a bundle, then read the
# right pages as IMAGES. Still DARK behind LEASE_OCR_ENABLED.
#
# WHY (proven on Noam's real 50 Glenrose 28-page bundle): a lease PDF is often a
# PACKAGE - RECO guide, tenant rep agreement (Form 372), Agreement to Lease
# (Form 400), schedules, co-op form - in a VARYING order. The lease terms there
# were on PAGE 19, so "first 8 pages of the PDF" read the guide and missed the
# lease. Also, signed/flattened OREA forms scramble their filled values in text
# extraction, so the tenant name/rent can be lost.
#
# WHAT IT ADDS:
#  - lib/lease-locator.ts (PURE): classify each page by OREA/RTA FORM NUMBER +
#    title and window on the actual lease. Priority: Ontario Standard Lease
#    (self-serve, form 2229) > Agreement to Lease (Form 400) > a landlord's own
#    CUSTOM agreement (content heuristic) > else null (caller reads first pages).
#    Skips RECO guide / Form 372 rep / Form 324 co-op. 25/0 tests, and verified
#    against the real 28-page bundle (pinned page 19).
#  - lib/lease-extract-vision.ts: new `images` source (multiple Anthropic image
#    blocks, capped at 8).
#  - app/dashboard/tenancies/actions.ts: extractLeaseFromImages server action
#    (manage_tenancies-guarded, org-scoped).
#  - lease-upload-prefill.tsx: read up to 40 pages of text on-device, LOCATE the
#    lease, RASTERIZE the located window to JPEGs in the browser, send those to
#    the model (text of the located window is the fallback). Shows what it found.
#
# NO migration. NO money surface. Lease bytes never leave the device except the
# located page rasters/text sent to the model transiently; PII guard unchanged.
# tsc clean, eslint clean, no new em dashes.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

npx tsc --noEmit
npx tsx scripts/test-lease-extract.ts
npx tsx scripts/test-lease-locator.ts
npx next lint \
  --file "lib/lease-locator.ts" \
  --file "lib/lease-extract-vision.ts" \
  --file "app/dashboard/tenancies/actions.ts" \
  --file "app/dashboard/tenancies/new/lease-upload-prefill.tsx"

git add \
  "lib/lease-locator.ts" \
  "scripts/test-lease-locator.ts" \
  "lib/lease-extract-vision.ts" \
  "app/dashboard/tenancies/actions.ts" \
  "app/dashboard/tenancies/new/lease-upload-prefill.tsx" \
  "LEASE-OCR-EXTRACTION-SPEC-2026-07-06.md"

git commit -m "S425b: lease-OCR locates the lease in a bundle + reads located pages as images (DARK)

A lease PDF is often a package (RECO guide, rep agreement, Agreement to Lease,
schedules) in varying order; the lease can start deep in the file. New pure
lease-locator classifies pages by OREA/RTA form number + title and windows on the
actual lease (Standard Lease > Form 400 > custom > else first pages), skipping the
guide/rep/co-op forms. The client then rasterizes only the located pages and sends
them as images so signed/flattened forms' filled values stay tied to labels.
Verified against a real 28-page bundle (pinned page 19). 25/0 locator tests, 80/0
extract tests. Still DARK behind LEASE_OCR_ENABLED. No migration, no money surface."

git push origin main
echo "Pushed. Still DARK until LEASE_OCR_ENABLED=1 in Vercel (after synthetic-lease QA)."
