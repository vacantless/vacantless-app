# CODEX BUILD — S614 Lane A: channel-aware property fields + readiness engine (foundation for the add-a-property rethink)

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-02
**Type:** additive data model + pure backend libs + feed correctness fix. NO UI in this lane.
**Migration:** 0206 (additive columns on `public.properties`; nullable; dark-safe)
**Risk:** low. New columns are null for every existing row → inert until Lane B (the UI) populates them. The only live behavior change is a feed **bugfix** (property type), which Cowork warm-verifies before deploy.

This is Lane A of a two-lane rethink. Design doc (context, not required reading): the per-portal field matrix. Lane B (a redesigned import-first `/properties/new` + live channel-readiness meter UI) builds ON this lane and is a separate ticket. **Do not build any UI here.**

---

## Standing rules (same loop as S613/S614)
- **Warm-verify FIRST:** before writing code, read the current `properties` schema usage, `lib/property-features.ts`, `lib/listing-feed.ts`, `lib/listing-extract.ts`, `lib/share-readiness.ts`, `lib/post-publish-qa.ts`, and `lib/distribution-capabilities.ts`. Match their existing style (pure funcs, normalizers, `is<X>`/`<X>_LABELS` maps).
- Codex **builds + verifies + commits by name**. Do **NOT** push. Do **NOT** apply the migration. Cowork warm-verifies vs prod, applies 0206 via Supabase MCP + SQL readback BEFORE deploy, then Noam pushes file-scoped.
- Everything additive; keep existing fields + call sites working unchanged.
- Gates: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `git diff --check`, and every new/[changed] pure test green. Report branch, SHA, diffstat, test counts.

---

## Scope

### 1. Migration `supabase/migrations/0206_property_channel_fields.sql` (additive, nullable)
Add to `public.properties` (mirror the nullable style of existing `heat_included`/`hydro_included`/`water_included`):
- `internet_included boolean` (nullable)
- `cable_included boolean` (nullable)
- `amenities text[]` (nullable) — enumerated rich amenities (validated in app, see §2)
- `parking_type text` (nullable) — enum in app: `none|street|outdoor|covered|garage|underground|ev`
- `parking_count integer` (nullable)
- `heating_type text` (nullable) — enum in app: `forced_air|baseboard|radiant|heat_pump|electric|other`
- `security_deposit_cents integer` (nullable)
- `income_requirement text` (nullable) — free-text note (e.g. "3x rent, credit check")
- `video_url text` (nullable) — distinct from existing `virtual_tour_url`
- `latitude double precision` (nullable)
- `longitude double precision` (nullable)

Keep existing `parking text` (free text) — do NOT drop it; `parking_type`/`parking_count` augment it. No RLS changes (properties RLS already exists). Add brief column comments. Use `add column if not exists`.

### 2. `lib/property-features.ts` — extend the pure builders
- **Canonical amenity enum** — add an exported `AMENITY_KEYS` set + `AMENITY_LABELS` map + `isAmenityKey(x)` + `normalizeAmenities(input): string[]` (dedupe, keep only known keys, stable order). Curated canonical list (map to RESO multi-lookups + Kijiji/RentFaster checklists): `dishwasher, fridge, stove, microwave, in_unit_storage, storage_locker, elevator, gym, pool, concierge, wheelchair_accessible, fireplace, bike_storage, ev_charging, security_system, hardwood_floors, yard`. (Do not duplicate fields that already have first-class columns: laundry, air_conditioning, balcony, furnished, pets — those stay as-is.)
- **Utilities:** extend `buildUtilitiesIncluded` to include `internet_included` and `cable_included` alongside heat/hydro/water.
- **Parking:** add `PARKING_TYPE_LABELS` + `isParkingType` + a `formatParking(parking_type, parking_count, parkingFreeText)` that prefers structured, falls back to the free-text `parking`.
- **Heating:** add `HEATING_TYPE_LABELS` + `isHeatingType` (pairs with existing `ac_type`).
- **Property type mapper (the feed bugfix):** add a pure `feedPropertyType(unit_type, structure_type): string` that derives a normalized listing property type from the EXISTING `unit_type`/`structure_type` values (reuse `isUnitType`/`UNIT_TYPE_LABELS`/`isStructureType` already in this file). Return the aggregator-appropriate type (`apartment|condo|house|townhouse|basement|duplex|loft|room|other`), defaulting to `apartment` only when nothing is known. Extend `UnitFeatures` type with the new fields.

### 3. `lib/listing-feed.ts` — emit correct type + new structured fields
- Replace the hardcoded `DEFAULT_PROPERTY_TYPE` usage so each `<listing>` emits `feedPropertyType(unit_type, structure_type)` (keep `DEFAULT_PROPERTY_TYPE` as the fallback constant).
- Include the new utilities (internet/cable), `amenities`, `parking_type`/`parking_count`, and `video_url` in the structured feed output where the schema/aggregator supports them. Keep the existing no-links / ≤3500 char / ≤50 photos / ≥50-char-description rules intact. New columns are null for existing rows, so output is unchanged except property type until Lane B populates them.

### 4. NEW `lib/channel-readiness.ts` — pure engine the Lane B meter will render
- Export `PropertyReadinessInput` (the fields needed) and `computeChannelReadiness(input): ChannelReadiness[]`.
- Channels v1 (programmatic only): `vacantless_page`, `syndication_feed` (Zumper/PadMapper/Rentals.ca), `rentfaster`, `kijiji`, `facebook_marketplace`. (Represent MLS as an informational entry with `advisoryOnly: true` and NO required flags — do not assert TRREB requiredness.)
- Per channel return `{ channel, label, status: "ready" | "missing_required" | "missing_recommended", missingRequired: string[], missingRecommended: string[] }`.
- REUSE `lib/share-readiness.ts` + `lib/post-publish-qa.ts` logic where it already encodes required/recommended (address, rent, beds+baths, ≥50-char description, ≥1 photo, city, etc.) rather than re-deriving. Encode the per-channel deltas from the design matrix (e.g. feed requires description≥50 + property type + ≥1 photo + contact phone; facebook flags the no-clickable-links + ≥1 photo; rentfaster/kijiji recommend the amenity/utility set). Pure, no I/O.

### 5. `lib/listing-extract.ts` — extend paste/PDF extraction to the new fields
- Extend the extractor so pasted MLS/realtor.ca/Kijiji text populates the new fields where present: internet/cable included, amenities (map free text → `AMENITY_KEYS`), parking_type/count, heating_type, security_deposit, video_url. Keep existing extraction behavior unchanged; only add.

### 6. Tests (pure, no network)
- NEW `scripts/test-channel-readiness.ts`: a fully-filled listing → all v1 channels `ready`; a bare listing (address+rent only) → correct `missing_required` per channel; a listing missing photos → facebook/feed flag it; MLS entry is advisory with no required flags.
- Extend `scripts/test-property-features.ts`: `normalizeAmenities` (dedupe/unknown-drop/order), `feedPropertyType` (apartment/condo/house/townhouse/basement/room + unknown→apartment fallback), utilities incl. internet/cable, `formatParking` structured-vs-freetext.
- Extend `scripts/test-listing-feed.ts`: a house listing now emits `house` not `apartment`; new fields appear when set, absent when null; existing assertions still pass.
- Extend `scripts/test-listing-extract.ts`: pasted text with amenities/utilities/parking/deposit populates the new fields.

---

## DONE criteria
`npx tsc --noEmit`, `npm run lint` (known job-page `<img>` advisory allowed), `npm run build`, `git diff --check` all clean; all pure tests green with counts reported. Commit message: `feat: channel-aware property fields + readiness engine (add-property lane A)`. Reply with branch, SHA, diffstat, and test counts. Do NOT push or apply the migration.

## Cowork warm-verify checkpoints (after Codex, before deploy)
1. Diff scope = migration + the 4 libs + 4 test files only; nothing else touched.
2. Re-run all pure tests in the cloud (device node_modules is macOS-arm; tsx fails in the linux bridge VM — run in the cloud container).
3. Apply 0206 via Supabase MCP + SQL readback (columns present, nullable, existing rows null).
4. **Feed XML diff** for the QA org's listings: confirm the property-type bugfix produces correct + valid types for houses/towns and nothing else in the XML regressed. Only then hand Noam the file-scoped push.
