#!/usr/bin/env bash
# S431 - Feature B (AI listing import) availability-date past-clamp.
# cleanIsoDate in lib/listing-extract.ts only range-checked the year (2000-2100),
# so a bare "September 1st" the model dated to a PAST year (e.g. 2024-09-01)
# persisted a broken past availability date onto the draft. Fix:
#   - new const AVAILABILITY_PAST_GRACE_DAYS = 90; cleanIsoDate now takes a `now`
#     and nulls a date older than now-90d (grace keeps a genuine "available now");
#   - normalizeListingDraft threads an optional `now` (default new Date()), so the
#     sole prod caller (parseListing) is byte-identical.
# Ships DARK: Feature B stays gated (LISTING_AI_IMPORT_ENABLED unset + Growth+).
# No migration, no env, no UI. Gates: tsc + eslint clean;
# test-listing-extract 81->88/0, test-billing 254/0, test-mls-import 108/0.
set -euo pipefail
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add lib/listing-extract.ts scripts/test-listing-extract.ts codex-handoffs/S431-LISTING-DATE-CLAMP.md
git commit -m "S431: clamp AI-inferred availability dates - null a stale past year in cleanIsoDate (Feature B, dark)"
git push origin main
