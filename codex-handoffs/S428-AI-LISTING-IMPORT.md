# S428 - Feature B: AI listing import (backfill for the MLS parser)

Review scope: one commit (see `DEPLOY-S428-AI-LISTING-IMPORT.sh`).
No migration, no schema change. Ships DARK behind env `LISTING_AI_IMPORT_ENABLED`
(unset in prod) and additionally gated on a Growth+ plan entitlement, so with the
flag off the behavior of `importPropertyFromMls` is byte-identical to before.

Gates (run in sandbox via `node --experimental-strip-types` + the resolve shim;
`tsx` can't run in the Linux sandbox, KI652): `tsc --noEmit` clean; eslint clean
on all touched files; `test-listing-extract` 62/0 (new), `test-billing` 254/0,
`test-mls-import` 108/0 (regression, unchanged). No new comment em dashes.

## What this is
The deterministic `parseMlsListing` (lib/mls-import.ts) reads MLS / realtor.ca
label + column formats. A NON-MLS source - a Kijiji / Facebook / PM-page blurb an
operator pastes - is free prose the regex can't read, so those imports come back
nearly empty. Feature B adds an AI extraction that produces the SAME
`ParsedListing` shape and BACKFILLS only the fields the deterministic parse left
unset. It is a sibling of the S425 lease-OCR build (same pure/impure split, same
Anthropic Messages wiring, same ASCII-key guard) but with NO PII guard, because a
listing is public marketing copy, not a tenant record.

## Files
1. **lib/listing-extract.ts (NEW, PURE)** - the contract:
   - `ListingDraft` = a SUBSET of `ParsedListing` (omits `virtualTourUrl`,
     `foundFields`, and any PET field). Booleans are TRI-STATE (`true`/`false`/
     `null`).
   - `LISTING_SYSTEM_PROMPT` + `buildListingExtractionPrompt()` - the schema the
     model must return. The prompt explicitly does NOT ask for a pet policy.
   - `normalizeListingDraft(raw)` - clamps every field to the same bounds the
     manual property form enforces (rent cents ceiling, rooms 0-20, sqft, ISO
     date range, laundry validated against the shared `LAUNDRY_OPTIONS` enum);
     tolerates snake_case alias keys.
   - `applyAiListing(base, ai)` - THE MERGE (the heart of the review). Returns a
     NEW `ParsedListing` + the list of labels the AI added. Rules:
       - scalar/laundry: filled only when `base[key] == null`.
       - booleans: set to `true` only when the base did NOT already find that
         feature (its label absent from `base.foundFields`) AND the AI is `true`.
         An AI `false`/`null` never demotes or touches the base default.
       - the deterministic base ALWAYS wins; the model never overwrites a value
         the regex found; `base` is not mutated.
   - Reuses the generic, already-tested `extractJsonObject` + `isAsciiApiKey`
     from lib/lease-extract (no lease/PII coupling; re-exported).
2. **lib/listing-extract-vision.ts (NEW, IMPURE)** - `parseListing(source)`:
   Anthropic Messages call, never-throws typed union, ASCII-key guard, 30s
   timeout, Haiku default (`LISTING_EXTRACT_MODEL` override). TEXT + IMAGE(S)
   paths. Returns `{ok:false,reason:"unconfigured"}` with no `ANTHROPIC_API_KEY`
   (dark). Not exercised in the sandbox (KI: no external API from sandbox); the
   request shape matches the documented API and live-proves on deploy.
3. **lib/mls-import.ts** - `FIELD_LABELS` is now EXPORTED (the only change) so the
   merge labels backfilled fields with the same human labels the review banner
   uses. `ParsedListing` / parser logic unchanged (108/0).
4. **lib/billing.ts** - new `listing_ai_import` PlanFeature (Growth/Premium/pilot
   true; core/plus/free/trial false) + `canUseListingAiImport(plan)`. Mirrors the
   `lease_ocr` entitlement. NO monthly cap in this slice (entitlement bounds it to
   paying orgs; a per-org monthly cap like `leaseOcrMonthlyCap` is the noted
   Slice 1b fast-follow if usage warrants a migration).
5. **app/dashboard/properties/actions.ts** - `importPropertyFromMls` now: parse
   deterministically first, then (only if `LISTING_AI_IMPORT_ENABLED` AND
   `canUseListingAiImport(org.plan)` AND non-empty paste) call `parseListing`
   over the SAME text and `applyAiListing` the result. Any model outcome other
   than a usable draft is swallowed - the operator still gets their deterministic
   draft; the AI is strictly additive and never a failure surface. The empty
   guard now runs on the merged `foundFields`. Redirect carries `&ai=<count>`
   (unknown param, harmless; groundwork for a review-banner note).

## Things to check first
- **Base-always-wins invariant**: `applyAiListing` never overwrites a non-null
  base scalar or a base-found boolean; confirm the merge + the `foundFields`
  dedupe (a label is never added twice). Covered by test-listing-extract.
- **Dark/gated**: with the flag unset the action is byte-identical; the AI block
  is skipped before any network call. Confirm the flag AND entitlement are both
  required.
- **No PII path**: this is public listing text; there is deliberately no
  redaction guard and no pet inference (RTA s.14, matches `parseMlsListing`).
- **No new UI**: Slice 1 is the TEXT path through the existing `mls_text`
  textarea. The IMAGE(S) path exists in the vision adapter but is NOT wired to a
  client island yet (Slice 2 = photo drop + on-device rasterize, mirroring
  mls-pdf-import.tsx / the lease-OCR island).

## Live QA plan (after deploy, on North Star QA b733a191, Growth)
Set `LISTING_AI_IMPORT_ENABLED=1` + confirm `ANTHROPIC_API_KEY` in Vercel, paste a
real non-MLS Kijiji/FB blurb, confirm the draft pre-fills fields the regex missed
(and that a normal MLS paste is unchanged), then unset the flag to return DARK.
