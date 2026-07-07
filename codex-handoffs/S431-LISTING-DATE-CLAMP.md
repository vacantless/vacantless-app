# Codex handoff - S431 Feature B availability-date past-clamp

Range: review the S431 commit (2 files, no migration, no env, no UI). App HEAD before = `2388079`.
Status: SHIPS DARK - Feature B (AI listing import) stays gated behind env `LISTING_AI_IMPORT_ENABLED` (unset) + a Growth+ entitlement, so this is a pure-lib correctness fix inside a feature that isn't live.
Context: `cleanIsoDate` in `lib/listing-extract.ts` only range-checked the year to `[2000, 2100]`. When a source gives a bare "September 1st" the model must guess a year and can pick a PAST one (e.g. last year's `2024-09-01`), which the range check happily let through and would persist a broken past availability date onto the draft. This clamps it.

## The fix

### `lib/listing-extract.ts`
- New exported const `AVAILABILITY_PAST_GRACE_DAYS = 90`.
- `cleanIsoDate(v)` -> `cleanIsoDate(v, now: Date)`: after the existing year/month/day validity checks, it now also nulls a date older than `now - AVAILABILITY_PAST_GRACE_DAYS`. The grace keeps a genuine "available now" date dated a few weeks ago; anything staler is treated as a wrong-year inference and nulled (leaving the field for the operator, consistent with the codebase's "null when uncertain, never guess" posture - same spirit as pets left to inherit).
- Comparison is done in UTC via `Date.UTC(...)` on both the parsed date and a `now`-midnight floor, so it is not time-of-day sensitive. The returned string is still the raw matched `YYYY-MM-DD` (no normalization of the returned value).
- `normalizeListingDraft(raw)` -> `normalizeListingDraft(raw, now: Date = new Date())`; `now` is threaded to `cleanIsoDate`. Default `new Date()` keeps the sole production caller (`lib/listing-extract-vision.ts:178 parseListing`) byte-identical - it passes no `now`, so prod uses the real clock.

### `scripts/test-listing-extract.ts`
- The date block now uses a fixed `NOW = 2026-07-07` reference passed explicitly, making the past-guard cases deterministic AND future-proofing the whole block (literal future dates no longer rot into the past as the real wall clock advances).
- Added cases: stale past year (`2024-09-01`) -> null; last-year same-month (`2025-09-01`) -> null; recent past within grace (`2026-06-15`) -> kept; today kept; grace boundary `2026-04-08` inclusive kept; `2026-04-07` just past grace -> null; and a default-`now` path (no arg, `2099-01-01`) still kept.
- Suite: `test-listing-extract` 81 -> **88/0**.

## Gates [verified 2026-07-07 via node -r sucrase/register + tsc]
- tsc `--noEmit` clean; eslint clean on both touched files.
- `test-listing-extract` 88/0, `test-billing` 254/0, `test-mls-import` 108/0 (no regression).
- No em dashes in the new code/comments.

## Specific things to check (highest value first)
1. **Only `availableDate` behavior changed.** The two identically-named `cleanIsoDate` functions in `lib/asset-capture.ts` (purchase_date - where PAST dates are legitimate) and `lib/lease-extract.ts` are SEPARATE definitions and untouched. Confirm no shared coupling.
2. **The floor math.** `Date.UTC(y, m-1, d)` for the parsed date vs `Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 90*86_400_000`. Confirm the boundary is inclusive (parsed == floor is KEPT) and there is no DST/timezone drift because both sides are UTC-midnight epoch ms.
3. **Grace choice.** Is 90 days a reasonable line between "available now / recently listed" and "wrong-year inference"? A year-off error is >= ~365 days so it is caught decisively; the risk is only nulling a genuine 3-months-stale date (harmless: operator re-enters on the draft).
4. **Signature back-compat.** `normalizeListingDraft`'s new `now` param is optional with a `new Date()` default; the vision caller is unchanged. Confirm nothing else calls it positionally in a way the extra param could break.
