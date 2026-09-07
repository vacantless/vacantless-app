# SPEC S688: Post Everywhere Slice 2, the one question sheet (Screen 2), build-ready

Date: 2026-09-06 (Session 688). Status: SPEC ONLY, no code. Follows Slice 1 (`SPEC-S688-POST-EVERYWHERE-SLICE1-BUILD-READY.md`); code after the Meta verdict (2026-09-22) and after Slice 1 ships. Builder: Cowork.
Parent: `claude/PROPOSAL-S685-ONE-QUESTION-SHEET-THEN-POST-EVERYWHERE.md`.
Code read 2026-09-06 against app `2f5b0c3` and worker `9af7fc2`. Line numbers below are from that read.

## 0. The problem in one paragraph

Today the property page computes "missing details" from `PORTAL_REQUIREMENTS` (`lib/portal-requirements.ts`, Rentsync partner docs, verified 2026-08-22) and links the landlord to ONE field at a time in the setup tab (`distribute-tab.tsx:1275-1303`, `ListingPacketCard`). The worker then composes each portal form from the record and, where a fact is missing, silently substitutes a default and pushes a `(fallback:...)` marker nobody reads (`compose.ts:254-386`): unfurnished, one-year lease, no pets, no A/C, non-smoking, no parking, apartment, owner, move-in today, accessibility No. Three of those facts can never be "unanswered" in the database because `furnished`, `air_conditioning`, `balcony` are `boolean not null default false` (migration 0013), so the app's `furnished` fact is always true (`page.tsx:2565`) and the worker's `p.furnished == null` branch (`compose.ts:303`) can never fire. Meanwhile the two lists disagree about what actually blocks a post: the worker's Kijiji real-fact set is rent, sqft, bedrooms, bathrooms, location, photo (`submit-logic.ts:93-100`), Zumper will not pass Listing details without a size (`listing-fill-sheet.ts:1026-1027`) and marks move-in missing with no fallback (`compose.ts` Zumper branch), Rentals.ca hard-stops in compose on org email or phone (`compose.ts:724-734`) and states a 2-photo minimum (`phase-b-submit-rentals.ts:113-114`), while `PORTAL_REQUIREMENTS` marks `square_footage` recommended everywhere and `availability_date` recommended everywhere. S685 paid for this: the Manning and Glenrose posts were done by hand precisely because every form asked something the record did not hold.

Screen 2 asks everything the selected sites need, once, in one sheet, writes real columns, and records that the sheet was completed so a default is never silently posted again.

## 1. What Slice 2 delivers

- `/dashboard/add-details?property=<id>` (today a dark three-card router, `app/dashboard/add-details/page.tsx:28-31`) becomes the question sheet when `?property=` is owned by the org; without `?property=` it stays the router.
- The sheet is generated per property from: the channels the landlord connected in Screen 1 (Slice 1 tile states `linked` or `connected_needs_authorization`; fallback = `defaultLaunchPortalChannels`, `page.tsx:1954-1957`), the corrected requirement table (section 3), and the record. It lists ONLY the questions whose answer the record does not hold, required ones first, each with "which sites need it".
- Answers write to real `properties` / `organizations` columns through the existing normalizers in `updateProperty` (`actions.ts:975-1025`) plus the four columns that form never wrote (`postal_code`, `parking_type`, `parking_count`, `amenities`). No shadow answers table.
- Migration 0226 makes the three hidden booleans honest tri-states (the 0050 precedent) and adds `properties.question_sheet_completed_at`.
- The worker keeps every fallback for records where `question_sheet_completed_at is null` (nothing regresses), and for completed records treats a null on an asked field as a compose failure with a named reason instead of a silent default.
- Nothing posts. Screen 3 (board + failure translation) is Slice 3.

## 2. Migration `supabase/migrations/0226_properties_question_sheet.sql`

```sql
-- ============================================================================
-- 0226_properties_question_sheet
--
-- Post Everywhere Slice 2 (SPEC-S688 Slice 2). Two changes:
--  (1) furnished, air_conditioning, balcony become tri-state (null = never
--      asked), exactly as 0050 did for pets_* and *_included. Existing false
--      values are LEFT AS FALSE: a backfill to null would erase real answers
--      from landlords who filled the setup form. The question sheet re-asks
--      these three on every property whose sheet has not been completed, so
--      the honest state is reached one sheet at a time.
--  (2) question_sheet_completed_at marks that the landlord answered the
--      sheet for this property; the worker reads it (section 6).
-- Idempotent.
-- ============================================================================

alter table public.properties
  alter column furnished drop not null,
  alter column furnished drop default,
  alter column air_conditioning drop not null,
  alter column air_conditioning drop default,
  alter column balcony drop not null,
  alter column balcony drop default;

alter table public.properties
  add column if not exists question_sheet_completed_at timestamptz,
  add column if not exists question_sheet_channels text[];

-- Decision 5 (Noam 2026-09-07): "for rent by" is who the landlord is, not what the unit is.
-- Asked once per organization by the sheet; properties.for_rent_by keeps its column for
-- the worker (the app copies the org value onto the property when the sheet saves) so
-- compose.ts needs no change.
alter table public.organizations
  add column if not exists for_rent_by text
    check (for_rent_by is null or for_rent_by in ('owner', 'professional'));
comment on column public.organizations.for_rent_by is
  'Owner or professional, answered once by the question sheet. Null = never asked. Copied to properties.for_rent_by on every sheet save.';

comment on column public.properties.question_sheet_completed_at is
  'Set by the Post Everywhere question sheet when every required question for the selected channels had an answer. Null = worker may still fall back to defaults (legacy behaviour).';
comment on column public.properties.question_sheet_channels is
  'Channel keys the sheet was completed for. A new channel added later re-opens the sheet for that channel''s extra questions only.';
```

Readers to update in the same deploy (a nullable boolean breaks a `boolean` TypeScript field, not SQL): app `Property` type `page.tsx:337-339` (`air_conditioning: boolean | null; balcony: boolean | null; furnished: boolean | null;`), `listingPacketFacts.furnished` (`page.tsx:2565`, becomes `p.furnished != null`), `listingPacketFacts.air_conditioning` and `amenities` (already `=== true`, fine), `parseCheckbox(formData, "furnished")` in `updateProperty` (`actions.ts:1006-1008`) becomes `parseTriStateBool` for the three, with the setup form's three checkboxes replaced by the same tri-state select the utilities use (`page.tsx:3771-3783`). Worker `PropertyRow` already types them `boolean | null` (`compose.ts:35,42,48`); no worker change for the types.

## 3. One requirement table (correct `PORTAL_REQUIREMENTS`, do not add a second)

Add to each `PORTAL_REQUIREMENTS` row a `hardBlock: PortalRequirementFieldKey[]` list = the fields the live form or the worker compose refuses to proceed without, verified by object (a run outcome or a form error), separate from `required` (the partner doc). `buildListingPacketReadiness` and the sheet both use `hardBlock ∪ required` for "required questions" and `recommended` for the optional section. Values from the read (each with its evidence, keep the evidence in the row's `notes`):

| channel | hardBlock | evidence |
|---|---|---|
| kijiji | address, rent, beds_baths, square_footage, photos, property_type | `submit-logic.ts:93-100` real-fact set (rent, size, bedrooms, bathrooms, location, photo); `kijiji.json:26-31` free-plan diagnostics; unittype radio REQUIRED (`kijiji.json`), compose defaults it |
| zumper | address, rent, beds_baths, square_footage, photos, description, availability_date, property_type | `listing-fill-sheet.ts:1026-1027` (size blocks Listing details); `compose.ts` Zumper branch marks move-in and description missing with no fallback; `zumper.json:141` photos required to advance |
| rentals_ca | address, rent, beds_baths, photos (min 2), contact_phone, contact_email, property_type, availability_date, pets (decision 4: the form defaults pets to Yes, our default posts No; never guess) | `compose.ts:724-734` org contact hard stop; `phase-b-submit-rentals.ts:113-114` MIN_PHOTOS 2; compose marks move-in missing with no fallback |
| facebook (registry key `facebook` = Marketplace, assisted; not `facebook_feed`) | title, address, rent, photos, description, property_type | unchanged from `required` (`portal-requirements.ts:274-283`), operator assertion |
| facebook_feed, instagram | photos, post_caption (generated), tracked_link (generated) | `portal-requirements.ts:640, 662` |

Add `MIN_PHOTOS_BY_CHANNEL = { rentals_ca: 2 }` next to `MIN_DESCRIPTION_CHARS` in `lib/listing-feed.ts` and read it in the `photos` fact.

Extend `PORTAL_REQUIREMENT_FIELD_KEYS` with the facts the worker defaults today and the sheet must ask: `postal_code`, `smoking`, `for_rent_by`, `accessibility` (no column yet; see 4.3). `furnished`, `pets`, `air_conditioning`, `parking`, `utilities`, `laundry`, `lease_term` already exist as keys.

Add a third list per channel, `askedDefaults: PortalRequirementFieldKey[]` = fields the portal form has as a control that the worker fills from a default when the record is null. These become the sheet's "answer once so we never guess" section:

| channel | askedDefaults | worker default today (`compose.ts`) |
|---|---|---|
| kijiji | furnished, lease_term, pets, air_conditioning, smoking, parking, property_type, for_rent_by, utilities, laundry, availability_date, accessibility | unfurnished (:302), one-year (:345), No (:349), No (:355), non_smoking (:359), 0 spots (:331), apartment (:337), owner (:341), unchecked (:377-379), unchecked (:372-374), today (:292), No (:365) |
| zumper | lease_term, pets, property_type, parking, laundry, furnished, air_conditioning | "1 year", No, Apartment (4), none, unchecked, unchecked, unchecked |
| rentals_ca | lease_term, property_type, parking, utilities, furnished, air_conditioning (pets is in `hardBlock` for rentals_ca, decision 4) | "1-year" (:601-606), Apartment (:598), not included (:811-815), none (:794-800), No (:807), unchecked. Pets: worker default stays No (:805-806) for legacy records only; the Rentals.ca FORM defaults to Yes, which is why pets is a required question there |

## 4. The sheet (pure builder + page)

### 4.1 `lib/question-sheet.ts` (pure)

```ts
export type QuestionKey =
  | "rent" | "beds" | "baths" | "sqft" | "available_date" | "unit_type"
  | "postal_code" | "description" | "photos"
  | "furnished" | "lease_term" | "pets" | "air_conditioning" | "smoking"
  | "parking" | "utilities" | "laundry" | "for_rent_by" | "accessibility"
  | "contact_phone" | "contact_email";

export type QuestionInput =
  | { kind: "money" } | { kind: "integer"; min: number; max: number }
  | { kind: "decimal_half" } | { kind: "date"; minToday: boolean }
  | { kind: "text"; maxLength: number } | { kind: "textarea"; minLength: number }
  | { kind: "select"; options: readonly { value: string; label: string }[] }
  | { kind: "tri_state" } | { kind: "multi"; options: readonly { value: string; label: string }[] }
  | { kind: "pets" } | { kind: "parking" } | { kind: "photos"; min: number; current: number }
  | { kind: "org_text"; field: "public_contact_phone" | "public_contact_email" };

export type SheetQuestion = {
  key: QuestionKey;
  label: string;                 // "Square footage"
  help: string | null;           // "Kijiji and Zumper will not accept the ad without it."
  neededBy: PortalRequirementChannelKey[];
  tier: "required" | "answer_once" | "recommended";
  input: QuestionInput;
  current: unknown;              // prefilled when the record has a partial answer
  scope: "property" | "organization";
};

export type QuestionSheet = {
  propertyId: string;
  channels: PortalRequirementChannelKey[];
  questions: SheetQuestion[];   // required first (by neededBy.length desc, then label), then answer_once, then recommended
  requiredRemaining: number;
  complete: boolean;             // requiredRemaining === 0 and every answer_once has a non-null answer
};

export function buildQuestionSheet(input: {
  property: PropertyForSheet;   // the page.tsx select widened with postal_code, parking_type, parking_count, amenities, question_sheet_completed_at, question_sheet_channels
  org: { public_contact_phone: string | null; public_contact_email: string | null; reply_to_email: string | null; for_rent_by: string | null };
  photoCount: number;
  channels: readonly PublishChannelKey[];   // one key type across Slices 1 to 3; non-portal keys are ignored by the requirement table
  effectiveFeatures: EffectiveFeatures;   // the 0048/0050 inheritance already computed on the page
  callerCanEditOrg: boolean;              // roleCan(role, "manage_settings"); org-scope questions render read-only when false
}): QuestionSheet
```

`complete` is false when any channel in `input.channels` is missing from `property.question_sheet_channels`, even if every question is held (a channel added later re-opens the sheet for its extra questions, and `saveQuestionSheet` unions the array on completion).

"Does the record hold it" per question (one rule each; these REPLACE the ad-hoc facts at `page.tsx:2531-2570`, which then call `buildQuestionSheet` and derive `ListingPacketFieldFacts` from it, so there is one source of truth):

| key | held when | writes |
|---|---|---|
| rent | `rent_cents > 0` | `rent_cents` |
| beds / baths | `beds != null` / `baths != null` | `beds`, `baths` |
| sqft | `sqft > 0` | `sqft` |
| available_date | `available_date` is a date | `available_date` |
| unit_type | `unit_type` in `UNIT_TYPE_OPTIONS` | `unit_type` |
| postal_code | matches `/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i` | `postal_code` (asked only when kijiji is selected) |
| description | trimmed length >= 50 | `description` |
| photos | `photoCount >= max(1, MIN_PHOTOS_BY_CHANNEL[c] for selected c)` | link to `#property-photos`, not a form field |
| furnished / air_conditioning | `!= null` (after 0226) | tri-state |
| lease_term | in `LEASE_TERM_OPTIONS` (effective) | `lease_term` |
| pets | `pets_cats != null && pets_dogs != null` (effective); dog size asked only when dogs = true | `pets_cats`, `pets_dogs`, `pets_dog_size`, `pets_notes` |
| smoking | in `SMOKING_OPTIONS` (effective) | `smoking` |
| parking | `parking_type != null` (and `parking_count != null` unless type = none) | `parking_type`, `parking_count`; also refreshes the free-text `parking` with `formatParking()` so old readers keep working |
| utilities | heat, hydro, water all `!= null` (effective) | the three tri-states (+ internet, cable as optional) |
| laundry | in `LAUNDRY_OPTIONS` | `laundry` |
| for_rent_by | `org.for_rent_by != null` (decision 5: per organization, 0226 adds `organizations.for_rent_by`). Scope organization, asked only when kijiji is selected. On every sheet save the action copies `org.for_rent_by` onto `properties.for_rent_by` so the worker keeps reading the property column | `organizations.for_rent_by` (+ mirror to `properties.for_rent_by`) |
| accessibility | sheet completed (then `amenities` containing `wheelchair_accessible` = yes, absent = no); sheet not completed = not held. Prefill: yes / no when completed, blank when not | `amenities` contains `wheelchair_accessible` |
| contact_phone / contact_email | org `public_contact_phone` / (`public_contact_email` or `reply_to_email`) has text | `organizations.public_contact_phone`, `public_contact_email` (scope organization; shown once with "applies to all your listings") |

Tier assignment: `required` when the key is in `hardBlock ∪ required` of any selected channel and not held; `answer_once` when in `askedDefaults` of any selected channel and not held; `recommended` when in `recommended` and not held. A key held by the record is not shown at all. `neededBy` = the selected channels that list it.

### 4.2 Page

- `app/dashboard/add-details/page.tsx`: when `?property=` is owned, render `<QuestionSheetForm sheet={...} />` (client) instead of the three cards; keep `StageShell`, the `BackNext` to `/dashboard/link-portals?property=` and `/dashboard/send-live?property=`; the Next button is disabled with the count "3 required answers left" until `sheet.requiredRemaining === 0`.
- One form, one submit, server action `saveQuestionSheet(propertyId, formData)` in `app/dashboard/properties/actions.ts` beside `updateProperty`: reuses `normalizeLeaseTerm`, `normalizeSmoking`, `normalizeUnitType`, `normalizeLaundry`, `parseTriStateBool`, `parseDateOrNull`, `parseIntOrNull`, and the v2 path's parking/amenities writers (`actions.ts:808-845`); writes org contact fields only when `currentUserCan("manage_settings")`; otherwise those two inputs render read-only with "ask your admin", any submitted values for them are skipped, and the action returns `{ skippedOrgFields: ["contact_phone", ...] }` so the page can say so (no error, no partial failure). After the write it rebuilds the sheet; if `complete`, sets `question_sheet_completed_at = now()` and `question_sheet_channels = channels`. Partial saves are fine (every answered field is written; the timestamp is set only when complete).
- Input rules: money in dollars with cents formatting (`Intl.NumberFormat en-CA`), stored as cents; date picker min today (a past availability date is a `recommended`-tier warning, not a block); sqft integer 100 to 20000; postal code uppercased, space inserted.
- Copy via next-intl `stage2.*` keys; the current `stage2` empty-state copy stays for the router mode.

### 4.3 Accessibility

Kijiji has a REQUIRED "Accessibility Features Yes/No" radio and the worker always posts No (`compose.ts:362-365`). The record has no first-class column, but `amenities text[]` (0206) already has the key `wheelchair_accessible` (`property-features.ts:309-327`). Decision: the sheet asks "Is the unit wheelchair accessible?" as a tri-state and writes `wheelchair_accessible` into `amenities` (yes) or removes it (no); "never asked" = the sheet not completed. Worker: `kijiji-accessibility = amenities includes wheelchair_accessible ? "1" : "0"`, and the Zumper `zumper-am-wheelchair` enforce-off (S684) stays off until Zumper's checkbox is verified live. No new column.

### 4.4 Save contract and dark build (S692 amendment, 2026-09-07)

Added after the worker half (section 6) was built and reviewed. Two rules the page half must keep, both found by the S692 reviewer:

1. **Mirror effective values on stamp.** The held-rules for `lease_term`, `smoking`, `pets` and `utilities` read EFFECTIVE values (unit > building > org, `resolveEffectiveFeatures`), so a property can be complete without those columns being set on `properties`. The worker reads `properties.*` only (it always has). Therefore, in the same write that sets `question_sheet_completed_at`, `saveQuestionSheet` copies every resolved effective value whose property column is null onto `properties.*` (`lease_term`, `smoking`, `pets_cats`, `pets_dogs`, `pets_dog_size`, `heat_included`, `hydro_included`, `water_included`, `internet_included`, `cable_included`), exactly as this spec already mandates for `for_rent_by`. Mirroring happens only on the stamping save, so a partial save leaves inheritance intact. Consequence: once stamped, a later change to the building/org profile no longer flows into that property for those fields; the sheet is the property's own answer from then on.
2. **Dark until 0226.** The sheet is built and deployed before migration 0226 is applied (one Supabase project, every migration is prod; 0226 is held behind the Meta verdict). The loader reads `properties.question_sheet_completed_at, question_sheet_channels` and `organizations.for_rent_by` in their own guarded queries; a "column does not exist" answer (42703 / PGRST204) means the feature is off: `add-details` keeps rendering its three intake cards, the property page keeps its S691 packet facts, and `saveQuestionSheet` refuses with `sheet_unavailable`. Any other error is an error. The day 0226 lands the sheet appears with no deploy.

Also fixed by the amendment: section 4.3's Zumper line stands (enforce-off until verified live); the worker's Kijiji radio follows the amenity, Zumper's checkbox does not (worker `S692b`).

## 5. Ordering and grouping on screen

1. **Must answer for your sites** (tier required), sorted by how many selected sites need it, then label. Each line: label, control, "Needed by Kijiji, Zumper". Photos row shows "2 of 2 photos" or a link "Add photos" to `#property-photos` on the property page (returns with `?back=add-details`).
2. **Answer once so we never guess** (tier answer_once), same sort. Sub-copy: "Sites ask these on every ad. Today we would post the default shown in grey."
3. **Recommended** (collapsed by default).
4. **Your contact details** (scope organization), once, at the bottom, prefilled.

Prefill every control from the record when a partial value exists (for example free-text `parking` "1 covered carport" prefills `parking_type = covered, parking_count = 1` through `rentalsCaParkingType`-style regexes ported to the app as `inferParking()`; the landlord confirms).

## 6. Worker contract change (`vacantless-worker`, one file per composer)

Each composer (`composeKijijiFillValues`, `composeZumperFillValues`, `composeRentalsCaFillValues`) selects `question_sheet_completed_at` too and:

- `question_sheet_completed_at is null`: behaviour unchanged (fallbacks + `(fallback:...)` markers).
- `question_sheet_completed_at is not null`: a null on any `askedDefaults` field for that channel returns `{ ok: false, reason: "sheet_incomplete: <field list>" }` instead of substituting a default. The runner already releases to `needs_operator` with `compose failed (<reason>)` (`phase-b-submit.ts:2625-2626`, rentals `:770-772`, zumper `:227-229`), so no runner change; the app's Screen 3 translation (Slice 3) maps `sheet_incomplete` to "Answer N more questions" with a link back to the sheet.
- New derivations replacing regexes on free text when the structured column is set: parking from `parking_type` + `parking_count` (fallback to `parseParkingSpots(parking)` / `rentalsCaParkingType(parking)` when null); accessibility from `amenities`.
- Tests: extend `artifacts/smoke-phase-b.ts` (compose) with: completed sheet + null lease_term -> `sheet_incomplete: lease_term`; incomplete sheet + null lease_term -> value "one-year" + marker (unchanged); parking_type covered + count 1 -> Kijiji "1", Rentals.ca "covered" + included "1"; amenities with wheelchair_accessible -> `kijiji-accessibility "1"`.

## 7. Tests (app)

- `scripts/test-question-sheet.ts` (new, pure): for each question key, one "held" and one "not held" fixture; tier assignment for kijiji-only, zumper-only, rentals_ca-only, and all three; `neededBy` for sqft = [kijiji, zumper]; photos min 2 only when rentals_ca is selected; postal_code asked only with kijiji; contact rows have scope organization; `complete` false while any required or answer_once question remains, true after; a record with furnished = false (legacy) is HELD (not re-asked) while furnished = null is asked.
- `scripts/test-portal-requirements.ts` (extend or add): every `hardBlock` key is also in `required` or `recommended` of that row or explicitly listed in `askedDefaults` (no orphan keys); every channel with `hasFillSheet` has `askedDefaults`; `MIN_PHOTOS_BY_CHANNEL.rentals_ca === 2`.
- `scripts/test-stage1-connect-copy-truth.ts`: unchanged.
- The existing `ListingPacketCard` keeps rendering; its facts now come from the sheet builder, so its headline count for the Growth Test properties must match the sheet's `requiredRemaining` (assert in the readmodel test with one shared fixture).

## 8. Acceptance

1. Growth Test org, property with only address + rent + 1 photo, channels kijiji + zumper + rentals_ca: the sheet shows exactly: beds, baths, sqft, available date, property type, description, photos (needs 2), postal code (Kijiji), plus the answer-once block (furnished, lease term, pets, A/C, smoking, parking, utilities, laundry, for-rent-by, accessibility), plus contact phone and email if the org lacks them. Nothing else.
2. Answer all, submit once: every column reads back by object (`select ... from properties where id = ?`), `question_sheet_completed_at` set, `question_sheet_channels = {kijiji,zumper,rentals_ca}`; reopening the sheet shows "Nothing left to answer" and Next is enabled.
3. Same property, worker dark run for each of the three channels (`submit:*:dark`, Growth Test org): `composed.missing` contains no `(fallback:...)` marker for an asked field; `submit_ready` on all three.
4. A legacy property (sheet never completed) composes exactly as before: markers present, no `sheet_incomplete`.
5. Set `lease_term = null` on the completed property directly in SQL and run the Kijiji dark runner: `compose failed (sheet_incomplete: lease_term)`, item released to `needs_operator`, approval preserved.
6. Agile org: no sheet is shown unless someone opens `/dashboard/add-details?property=` for an Agile property; the migration's tri-state change does not alter any Agile row value (row counts of `furnished = false` before and after 0226 are equal).

## 9. Out of scope (Slice 3+)

- Screen 3 board and plain-language failure translation (`sheet_incomplete` is the first reason it will translate).
- Copy fitting per portal (title 64 on Kijiji, description 3500 on Zumper, tracked link only where allowed), photo triage, post-publish audit.
- Migrating the setup tab's free-text `parking` field away entirely; Slice 2 keeps it as a derived mirror.
- Per-org defaults for answer-once questions (a landlord with 20 units answering "non-smoking" once): valuable, needs an `organization_listing_defaults` design; note it, do not build it here.

## 10. Decisions (Noam, 2026-09-07, all three recommendations accepted)

4. **Rentals.ca pets: keep the worker default of No for legacy records, and make pets a REQUIRED question when rentals_ca is selected** (section 3 `hardBlock`, section 4.1). A completed sheet never posts a guessed pet policy anywhere.
5. **"For rent by owner or professional" is per organization.** `organizations.for_rent_by` added in 0226 (section 2); the sheet asks it once, scope organization; the save mirrors it onto `properties.for_rent_by` so the worker is unchanged.
6. **Org contact phone and email render read-only with "ask your admin" for anyone without `manage_settings`**; members with it edit inline. Submitted values from a caller without the capability are skipped and reported, never written (section 4.2).
