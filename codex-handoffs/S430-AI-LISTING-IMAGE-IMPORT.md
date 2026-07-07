# S430 - Feature B Slice 2: AI listing import from IMAGE(S)

**Status: Codex-ACCEPTED at source/test level 2026-07-06 (range dcfd82c..a08f085), no P1/P2.**
Confirmed: text path byte-identical after the `finishListingImport` extraction; image path
dark behind `LISTING_AI_IMPORT_ENABLED` + `canUseListingAiImport(org.plan)` on both page and
action (hand-posts redirect to `?import=unavailable` before `parseListing`); `selectListingImages`
correct + order-preserving; `VisionImageType` cast safe post-selection; image drafts merge onto
`emptyParsedListing()` so nothing deterministic is overwritten; pets out of contract. Gates green
(81/0 - 254/0 - 108/0, tsc + eslint clean).

**LIVE QA VERIFIED 2026-07-06 on North Star Rentals QA (Growth).** Flipped LISTING_AI_IMPORT_ENABLED=1
on Vercel (ANTHROPIC_API_KEY already set) + redeployed, uploaded a synthetic listing screenshot, and
the image path landed a Draft with ?imported=13&ai=13 - every field correct: address, rent $1,750
(scaled right, NOT $17.50), 2bd/1ba, 850 sqft, available 2025-09-01, in-suite laundry, A/C + balcony
checked (furnished off), utilities heat=included / hydro=tenant-pays / water=included, description
filled, and PETS LEFT TO INHERIT despite the image saying "Pet friendly" (RTA s.14 no-inference holds
on the image path). Landed private (Draft). Then reverted: removed the env var + redeployed, confirmed
the image-import card no longer renders (DARK), and retired the QA draft Off market. S430 is now
proven live end-to-end; the loop is fully CLOSED. Feature remains DARK in prod.


Review scope: the commit range handed with this note (5 files, no migration, no
schema change). Ships DARK behind env `LISTING_AI_IMPORT_ENABLED` (unset in prod)
AND the Growth+ `listing_ai_import` entitlement - same gate as the S428/S429 text
path. With the flag off the properties page and both import actions behave exactly
as before (the image form is not rendered; the new action is unreachable from the UI
and self-guards anyway).

## What this is
S428 shipped the TEXT path (paste a Kijiji/FB/PM-page blurb; a model backfills the
deterministic MLS parse). Slice 2 adds the IMAGE path: a listing that only exists as
a picture (a screenshot of a Facebook/Kijiji post, a photo of a flyer, a saved
listing image). There is no text to paste and no deterministic parse of a picture,
so the whole image path is AI-only and therefore fully gated. The model reads the
image(s) into the SAME `ListingDraft` the text path produces; we merge onto an EMPTY
`ParsedListing` and land a private Draft for review. Pets are NOT imported (RTA s.14),
same as the text path.

## Files (5, no migration)
1. **lib/listing-extract-vision.ts** - exported `MAX_IMAGES` (4) + new `MAX_IMAGE_BYTES`
   (8 MB) / `MAX_TOTAL_IMAGE_BYTES` (20 MB), and a NEW PURE `selectListingImages(metas)`:
   given each file's `{mimeType, sizeBytes}`, returns the indices to KEEP (supported
   vision mime, within per-image + total-byte + count caps) and, for each dropped file,
   the reason (`type` / `too_large` / `over_cap`). First-come order preserved so the
   operator's leading image always makes the cut. The impure `parseListing` network call
   is unchanged (it already supported `kind:"images"`).
2. **scripts/test-listing-extract.ts** - +6 pure cases for `selectListingImages` (keep a
   supported image; drop an unsupported type; drop an oversized image but keep a good one
   after it; cap at MAX_IMAGES preserving order; enforce the total-byte ceiling; empty
   list). 75/0 -> 81/0.
3. **app/dashboard/properties/actions.ts** - extracted the shared `finishListingImport(org,
   parsed, aiAdded)` (the 17-column draft insert + empty-guard + review redirect) OUT of
   `importPropertyFromMls` so BOTH paths share ONE insert (text path behavior byte-identical
   - it now just calls the finisher). NEW `importListingFromImages(formData)`: re-checks the
   env flag + entitlement server-side, reads `listing_images` File(s), runs `selectListingImages`,
   base64s the kept files, `parseListing({kind:"images"})`, merges onto `emptyParsedListing()`,
   lands the draft. Each failure maps to a distinct honest banner (`unavailable` / `badimage`
   / `aiempty` / `aifailed`).
4. **app/dashboard/properties/listing-image-import.tsx (NEW, client island)** - mirrors
   `mls-pdf-import.tsx`: image dropzone + a real `<input type="file" name="listing_images"
   multiple>` (drag-drop fills it via a `DataTransfer` so files post natively), thumbnail
   previews, and a submit button disabled until >=1 image. UX only; the server re-validates
   and always lands a private Draft (same trust boundary as the PDF island).
5. **app/dashboard/properties/page.tsx** - gate: `const aiImageImportEnabled =
   !!process.env.LISTING_AI_IMPORT_ENABLED && canUseListingAiImport(org?.plan)`. The image
   form (multipart, `action={importListingFromImages}`) renders ONLY when enabled. Added the
   4 new `import=` banners.

## Trust / safety
- DARK by default (env flag unset in prod) AND entitlement-gated (Growth+); the action
  re-checks both server-side, so a hand-posted request without the gate hits `?import=unavailable`.
- Server enforces type/size/count/total caps (`selectListingImages`) regardless of the client.
- No migration, no schema change, no new env beyond the existing `LISTING_AI_IMPORT_ENABLED`
  and `ANTHROPIC_API_KEY` (both already used by the text path).

## Gates
`tsc --noEmit` clean; eslint clean on all 5 touched files (one blob-preview `<img>` warning
suppressed inline - a local object-URL, not a remote asset); `test-listing-extract` 81/0,
`test-billing` 254/0, `test-mls-import` 108/0. No new comment/UI em dashes in the new files.
(ts-register.mjs shim named in the test header still absent; ran via `node -r sucrase/register`.)

## Live QA plan (image path can't be exercised from the build sandbox, per policy)
Deploy dark -> on North Star QA (Growth) set `LISTING_AI_IMPORT_ENABLED=1` + confirm
`ANTHROPIC_API_KEY` -> upload a real screenshot of a listing -> confirm a Draft is created
with fields prefilled and `?imported=N&ai=N` -> confirm pets left to inherit -> restore DARK
(remove the flag) and redeploy. Then verify the TEXT path still works unchanged (regression).

## Codex review asks
- The text path is byte-identical after the `finishListingImport` extraction (same insert,
  same empty-guard, same redirect contract).
- `selectListingImages` caps are correct and order-preserving; no realistic upload mis-handled.
- The image action's gate is defense-in-depth (UI gate + server re-check); a request without
  the flag/entitlement never reaches `parseListing`.
- base64 conversion + the `VisionImageType` cast are safe because selection validated the mime.
- Merge invariant intact: image drafts merge onto an EMPTY base, so nothing deterministic is
  overwritten (there is nothing deterministic).
