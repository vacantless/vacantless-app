# CODEX BUILD — S615: listing-extract taxonomy pass (property type → unit_type; pets pending decision)

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-02
**Type:** small parser enhancement — make the paste/import prefill map the listing's "Property Type" to `unit_type`. No UI, no new columns.
**Migration:** none.
**Flag:** none — improves the existing V2 prefill path (already behind `ADD_PROPERTY_V2_ENABLED`); the field it fills is operator-reviewable before save.
**Risk:** very low. Deterministic mapping + a couple of fields on an existing draft mapper.

## Why (dogfood finding, S614)
On the Lane B dogfood, a pasted realtor-style listing filled the whole superset **except** "Property Type: Condo Apartment" — the operator had to pick **Condo** manually. Root cause (warm-verified): `ParsedListing` (`lib/mls-import.ts`) has **no property-type field**, and `addPropertyV2DraftFromListing` (`lib/add-property-v2.ts`) **never sets `unit_type`/`structure_type`**, so they're always blank after prefill.

## Standing rules
- **Warm-verify FIRST:** `lib/mls-import.ts` (`ParsedListing`, `emptyParsedListing`, the label STOP-SET around L127 that already lists "property type"/"building type"/"type", and `parseMlsListing`'s label→value extraction), `lib/property-features.ts` (`UNIT_TYPE_OPTIONS` = apartment | condo | basement-apartment | house | townhouse | duplex-triplex; `STRUCTURE_TYPE_OPTIONS`; `normalizeUnitType`/`normalizeStructureType`), `lib/add-property-v2.ts` (`addPropertyV2DraftFromListing`), `lib/listing-extract.ts` (`ListingDraft`, the extraction JSON schema/prompt, `applyAiListing`), and `scripts/test-mls-import.ts` / `scripts/test-add-property-v2.ts` for test style.
- Deterministic first; keep the "never invent" posture. Match house style. Codex builds + verifies + commits by name; do NOT push; no migration. Gates: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `git diff --check`, pure tests green (report counts).

## Scope — SHIP THIS

### 1. Capture property type in the deterministic parser
- Add `propertyType: string | null` to `ParsedListing` (+ `emptyParsedListing`). In `parseMlsListing`, when a recognized label ("Property Type" / "Building Type" / "Type" already in the stop-set) yields a value, store the raw value in `propertyType`. Do not change existing fields' behavior.

### 2. Map raw property type → `unit_type` (and, where unambiguous, `structure_type`)
- Add a pure `mapUnitTypeFromRaw(raw: string | null): UnitType | null` in `lib/property-features.ts` (next to `normalizeUnitType`). Case/spacing-insensitive, substring-tolerant. TRREB/realtor.ca rental values:
  - `condo apartment`, `condo apt`, `comm element condo`, `apartment` (in a condo context) → **condo**; bare `apartment` → **apartment**
  - `condo townhouse`, `att/row/townhouse`, `townhouse`, `freehold townhouse`, `row` → **townhouse**
  - `detached`, `detached house`, `semi-detached` → **house**
  - `duplex`, `triplex`, `fourplex`, `multiplex` → **duplex-triplex**
  - `basement`, `basement apartment`, `lower level` → **basement-apartment**
  - anything unrecognized → **null** (operator picks; never guess wrong)
  - Disambiguation rule for a bare `apartment`: map to **apartment** unless the same value string contains "condo".
- In `addPropertyV2DraftFromListing`, set `draft.unit_type = mapUnitTypeFromRaw(parsed.propertyType ?? aiDraft?.propertyType) ?? ""` and add `"Property type"` to `filledFields` when it resolves. (Only fill when the mapper is confident; leave blank otherwise.)

### 3. AI path parity (so pasted-blurb imports benefit too)
- Add `propertyType: string | null` to `ListingDraft` (`lib/listing-extract.ts`) + the extraction JSON schema/prompt: `"propertyType":<one of a condo/apartment/townhouse/house/duplex/basement descriptor exactly as stated, or null>`. Normalize in `normalizeListingDraft` (trim, length-cap, else null). In `applyAiListing`, fill `propertyType` only when the deterministic parse left it null (deterministic wins, same as every other field).

### 4. Tests — pure
- `scripts/test-mls-import.ts`: a paste with "Property Type: Condo Apartment" → `parsed.propertyType === "Condo Apartment"`.
- `mapUnitTypeFromRaw` cases: each mapping above + the bare-`apartment` disambiguation + unknown → null.
- `scripts/test-add-property-v2.ts`: `addPropertyV2DraftFromListing` on a parse with `propertyType: "Condo Apartment"` → `draft.unit_type === "condo"` and `"Property type"` in `filledFields`.
- Keep all existing tests green.

## DO NOT SHIP YET — pets (needs Noam's explicit call)
**There is a deliberate, documented policy NOT to infer pet policy** (`lib/listing-extract.ts` header + `parseMlsListing`): pets are an RTA s.14 advertising/screening decision the landlord makes explicitly (S241), so the AI contract intentionally has **no pet field** and is told "Do NOT output a pet field." Mapping "Cats OK → `pets_cats`" **reverses that policy**, so it is NOT in this prompt's shippable scope.
- If Noam approves, the **narrow** version is: map ONLY a **structured MLS "Pets Permitted" field** (a value the landlord set on their own MLS listing — e.g. `Restricted`/`Yes`/`No`) inside the **deterministic** `parseMlsListing` → `pets_cats`/`pets_dogs`, and **leave the freeform-blurb AI path pet-free** (a Kijiji "cats ok" line is marketing copy, not a policy the landlord attested). That preserves the S241 intent while filling the one structured case. Await Noam's yes/no before building even the narrow version.

## Cowork warm-verify (after Codex)
Diff confined to the four files + tests; re-run pure tests; dogfood: paste a listing with "Property Type: Condo Apartment" on a QA org → Unit type auto-selects **Condo**; save → SQL readback `unit_type = 'condo'`. Delete QA row after.

Commit: `feat: map listing property type to unit_type on import (taxonomy pass)`. Reply branch/SHA/diffstat/test counts. Do NOT push.
