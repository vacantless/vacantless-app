# CODEX BUILD — S618 Lane 3: Collapse the add-property "detailed" block

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-03
**Type:** small IA/presentation fix on the import-first add-property flow (`/dashboard/properties/new`).
**Migration:** NONE. **Flag:** NONE. **Risk:** low. Single file, presentation only — no data model, no server action, no new field. Blast radius = `app/dashboard/properties/new/add-property-form.tsx`.
**Design of record:** `claude/DESIGN-ESL-SIMPLE-MODE-AND-DELETE-S618.md` (Lane 3).

## Why
Noam: "Add property is now a lot better, but then when you get to the next part, the more detailed part, it gets really long and confusing again." The go-live-required fields (address, rent, beds, baths) already sit in an always-visible **Core** section — but below it three dense collapsibles pile up, and the first one is **expanded by default**, so the form reads as a long confusing scroll. None of that block is required to get a listing online.

## Verified current-state (do NOT re-derive)
`add-property-form.tsx` (1,165 lines), render order:
- **Import** section (`≈462–573`) — keep as-is.
- **Core** `<section>` "Core" (`≈575–764`) — address, rent, beds, baths. Keep always-visible.
- Then three collapsibles:
  - `<details open ...>` **"Size, layout, and amenities"** (`766–907`) — **opens EXPANDED** (the `open` attribute). sqft, floor, lease term, heating, amenities, laundry, A/C, furnished/A-C/balcony.
  - `<details>` **"Parking and utilities"** (`909–982`) — already collapsed.
  - `<details>` **"Pets, smoking, money, and media"** (`984–1120`) — already collapsed. **⚠ The Photos `<input type="file" name="photos">` lives here (`1106–1118`)** — buried inside an oddly-named section.
- **Description** `<section>` (`≈1122–1146`) — keep visible.

## The job (three precise changes, nothing else)
1. **Collapse the first block by default:** remove the `open` attribute from the "Size, layout, and amenities" `<details>` (line ~766) so all three optional sections start closed.
2. **Add one intro line above the three collapsibles** (a plain `<p>` / small divider, not a new section) making it obvious they're skippable, e.g.: *"Optional — you don't need any of these to get online. Add them now or anytime later."* Match existing type scale (`text-xs text-gray-500`).
3. **Un-bury Photos:** move the Photos file input (`1106–1118`) OUT of the "Pets, smoking, money, and media" `<details>`. Put it in its own always-visible block **right after Core** (a light `<section>` titled "Photos (optional but recommended)") so the ESL user actually sees it. Keep the exact input (`id="photos" name="photos" multiple accept="image/*"` + the `setPhotoCount` onChange + the existing photoCount hint) so the submit/prefill contract is unchanged. Do NOT rename the field or change its handler.

Do NOT otherwise restructure the form, rename fields, change the server action, or touch Import/Core/Description logic. Do NOT convert the three `<details>` into a single nested parent (nested `<details>` is clunky) — three siblings, all closed, under the one intro line is the target.

## Gates (report each verbatim)
- `npx tsc --noEmit` → 0 errors
- `npm run lint` → clean (report new warnings on the file)
- `npm run build` → succeeds
- `git diff --check` → clean
- `npm run test` → still green (counts). No new pure logic here; no new unit test expected.

## Dogfood checklist (by hand)
- `/dashboard/properties/new`: Core + a visible Photos block show first; the three optional sections render **collapsed**; the intro line reads as skippable.
- Adding a property with **only Core** (address/rent/beds/baths) still creates a valid Draft and reaches Live — the optional block being collapsed does NOT drop any submitted value (the inputs are still in the DOM inside closed `<details>`, so the form still posts them).
- Expanding each optional section + Photos still saves those fields (sqft, parking, pets, utilities, photos) exactly as before. Import + geocode-autocomplete + prefill-from-text/image/PDF unaffected.

## Do NOT
- No migration, no flag, no server-action change, no new dependency.
- Do NOT `git add -A` — commit the one file by name (untracked `claude/*.md` + `_to_delete/` must not be swept in).
- Do NOT touch `/dashboard/properties/[id]` (that's Lane 2) or the rentals list (Lane 1).
- Do NOT drop or rename the `photos` input — just relocate it.

## Commit (single, clean; the one file by name)
```
feat(properties/new): collapse optional add-property details, surface photos

Only Core (address/rent/beds/baths) + Photos stay visible; size/parking/pets
sections start collapsed under a "skip to get online" note. Presentation only —
no field, migration, or server-action change.
```
Reply with branch/SHA/diffstat + every gate result. **Do NOT push.** No migration.
