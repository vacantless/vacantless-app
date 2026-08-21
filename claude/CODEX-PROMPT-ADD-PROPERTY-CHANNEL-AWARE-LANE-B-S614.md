# CODEX BUILD — S614 Lane B: import-first, channel-aware "Add a property" flow + live readiness meter

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-02
**Type:** new operator UI (a guided add-property flow) + one new create action. Builds ON Lane A (commit 8a62d63, mig 0206 already applied).
**Migration:** none (Lane A already added the fields).
**Flag:** `ADD_PROPERTY_V2_ENABLED` — ship DARK. Old add form stays fully intact and is the default when the flag is off.
**Risk:** medium (new UI + write path). Contained behind the flag; the existing `addProperty`/import forms are untouched.

Design + per-portal field matrix: `claude/DESIGN-ADD-PROPERTY-CHANNEL-AWARE-RETHINK-S614.md`. **Out of scope this lane:** address autocomplete + geocoding (Lane B2 — needs a provider/key decision; leave `latitude`/`longitude` unset for now). Do NOT build a new AI/description generator — reuse the existing one.

---

## Standing rules (same loop)
- **Warm-verify FIRST:** read `app/dashboard/properties/page.tsx` (current inline add form + the three actions it posts to), `app/dashboard/properties/actions.ts` (`addProperty`@185, `importPropertyFromMls`@264, `importListingFromImages`@381, `updateProperty`@438 — reuse their normalizers + insert shape), `lib/channel-readiness.ts` (`buildChannelReadiness`/`readinessByChannel`/`ChannelReadinessInput`), `lib/property-features.ts` (`AMENITY_LABELS`, `PARKING_TYPE_OPTIONS/LABELS`, `HEATING_TYPE_OPTIONS/LABELS`, `normalizeAmenities`), the existing listing-description/copy generator (`lib/listing-description.ts` + `lib/auto-listing-copy-ai.ts` / `lib/listing-copy.ts`), and `lib/listing-extract.ts` (the paste/PDF extraction that `importPropertyFromMls`/`importListingFromImages` already use).
- Codex **builds + verifies + commits by name.** Do NOT push. Do NOT apply anything (no migration). Cowork warm-verifies vs prod, Noam pushes + flips the flag + dogfoods.
- Reuse existing components/normalizers; do not duplicate logic. Match house style.
- Gates: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `git diff --check`, all pure tests green. Report branch, SHA, diffstat, test counts.

---

## Scope

### 1. New route `app/dashboard/properties/new/page.tsx` (server component, `force-dynamic`)
Gated: `if (!envFlagEnabled(process.env.ADD_PROPERTY_V2_ENABLED)) notFound();`. Resolve org via `getCurrentOrg`. Render the guided add experience (client component below). Mirror the existing page's PageHeader/section style. On success the create action redirects to the existing property detail page (`/dashboard/properties/[id]?created=1#rental-details`) — reuse the current post-create landing (lifecycle rail + finish-setup checklist), do not rebuild it.

### 2. Entry point on the Rentals list (`app/dashboard/properties/page.tsx`)
- When `ADD_PROPERTY_V2_ENABLED` is ON: add a prominent **"Add rental"** button in the page header linking to `/dashboard/properties/new`, and hide the old inline "Add a property" + import panel (or collapse it). When OFF: page is byte-unchanged.

### 3. The guided form (new client component, e.g. `app/dashboard/properties/new/add-property-form.tsx`)
Two clearly-visible modes, **import-first**:
- **Import (hero, default):** a paste box ("paste your realtor.ca / MLS / Kijiji listing") + a PDF/image drop (reuse the extraction the current import actions use). On extract → prefill the whole superset form below, then let the operator review/adjust. Nothing is created until they submit. Reuse `lib/listing-extract.ts`; do not write a new parser.
- **Start fresh (one tap away):** the same superset form, empty. Not buried — a visible toggle/tab beside Import.

**Superset fields**, grouped with progressive disclosure (core always visible; the rest in expandable groups) — all map to existing `properties` columns (Lane A added the new ones):
- Core: address, property type (`unit_type`/`structure_type` selects — reuse `updateProperty`'s normalizers), rent, beds, baths, available date, address privacy (`address_display_mode`).
- Size/layout: sqft, floor, furnished, lease term.
- **Amenity tap-chips** (not dropdowns): render `AMENITY_LABELS` as toggle chips → `amenities[]`; parking as `PARKING_TYPE_OPTIONS` chips + a count; heating as `HEATING_TYPE_OPTIONS`; plus first-class toggles for laundry, A/C (`air_conditioning`/`ac_type`), balcony.
- Utilities-included toggles: heat, hydro, water, **internet, cable**.
- Pets: cats / dogs / dog size / notes; smoking.
- Money/screening: security deposit, income requirement.
- Media: photos (reuse existing upload), virtual tour URL, **video URL**.
- **Description:** a textarea with an **"AI draft" button** that calls the EXISTING generator from the structured fields above and fills the box (editable). No new generator.

### 4. **Live channel-readiness meter** (client component, the centerpiece)
- As the operator edits, reactively compute readiness with the pure Lane A engine: `buildChannelReadiness(input)` (or `readinessByChannel`). Because it's pure it runs client-side on every change — no server round-trip.
- Render each channel (Vacantless page, syndication feed, RentFaster, Kijiji, Facebook Marketplace) as a row/badge: **ready ✓** vs **needs: {missingRequired}**, with recommended items as soft "improves reach" hints. MLS shows as an advisory row (no blocking flags), matching the engine's advisory-only entry.
- Required gaps never block saving a draft — they inform. This is the "fill until the channels you care about light up" UX.

### 5. New create action `createPropertyV2(formData)` in `app/dashboard/properties/actions.ts`
- Server action, org-scoped like `addProperty`; re-check `envFlagEnabled(process.env.ADD_PROPERTY_V2_ENABLED)` server-side (defense in depth) → if off, `redirect` back.
- Insert ONE row with the full superset (reuse `updateProperty`'s field normalizers + `addProperty`'s org/insert shape): address, rent_cents, beds, baths, unit_type, structure_type, sqft, floor, available_date, lease_term, description, parking (keep free text if provided), parking_type, parking_count, laundry, air_conditioning, ac_type, heating_type, balcony, furnished, amenities (via `normalizeAmenities`), heat/hydro/water/internet/cable_included, pets_cats/pets_dogs/pets_dog_size/pets_notes, smoking, security_deposit_cents, income_requirement, virtual_tour_url, video_url, address_display_mode, status='draft'/'available' per current default. Leave latitude/longitude null (Lane B2).
- `revalidatePath` + redirect to the detail page created-landing as above. Do NOT touch `addProperty` (old path stays).

### 6. Tests (pure, no network)
- Any NEW pure helper you extract (e.g. mapping form fields → `ChannelReadinessInput`, or amenity chip state) gets a `scripts/test-*.ts` with cases. Reuse Lane A's `channel-readiness`/`property-features` tests — do not duplicate them. Keep all existing tests green.
- (Server actions + React components aren't unit-tested here; Cowork dogfoods the UI live after flag-on.)

---

## DONE criteria
`npx tsc --noEmit`, `npm run lint` (known job-page `<img>` advisory allowed), `npm run build`, `git diff --check` all clean; pure tests green with counts. With the flag OFF, `/dashboard/properties` and `/dashboard/properties/new` behave exactly as today (`/new` → notFound). Commit: `feat: import-first channel-aware add-property flow + live readiness meter (lane B, dark)`. Reply with branch, SHA, diffstat, test counts. Do NOT push.

## Cowork warm-verify + go-live (after Codex)
1. Diff scope confined to the new route/components + the list-page entry gate + `createPropertyV2` + any new test. Old add path untouched.
2. Re-run pure tests in the cloud.
3. Confirm dark: flag off → list page byte-unchanged, `/new` = notFound.
4. Flag-on go-live (Noam types the value in Vercel, KI988) → dogfood on a QA org: import a pasted listing → superset prefilled; manual create → superset row written (SQL readback); readiness meter lights per channel; AI description fills; created property lands on the lifecycle rail. Reset QA rows after.
