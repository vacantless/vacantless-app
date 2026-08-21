# CODEX BUILD — S615 Lane B2 follow-up: Geoapify / OpenStreetMap attribution line

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-02
**Type:** tiny UI addition — show the required attribution near the address autocomplete. Geoapify's free plan is OSM/ODbL-based and requires visible attribution to Geoapify + OpenStreetMap wherever its geocoding results are shown.
**Migration:** none. **Flag:** none. **Risk:** trivial (one client component, presentational).

## Warm-verify first
Read `app/dashboard/properties/new/add-property-form.tsx` — the Address field block (the `<input name="address">` combobox ~L482, its suggestions listbox rendered from `addressSuggestions`, and the state: `addressSuggestions`, `selectAddressSuggestion`, `updateAddress`, `queueAddressSuggestions`). This is where B2's autocomplete lives (Radar/Geoapify seam via the `geocodeSuggest` server action). Match the file's existing styling helpers (`inputClass()`, the small-text/label classes already used).

## Scope — `add-property-form.tsx` only
Add a small attribution line directly beneath the Address field / suggestions listbox:

`Address search powered by Geoapify · © OpenStreetMap contributors`

- Link **"Geoapify"** → `https://www.geoapify.com/` and **"OpenStreetMap contributors"** → `https://www.openstreetmap.org/copyright`. Both `target="_blank" rel="noopener noreferrer"`, styled as subtle small muted text (mirror the form's existing helper-text class, e.g. the `text-xs text-gray-500` pattern used elsewhere in this file). No new layout section — a single line under the field.
- **Gate it to when autocomplete is actually active** (graceful degradation: with no `GEOAPIFY_API_KEY`, no suggestions ever return, and no Geoapify data is shown, so no attribution should appear). Simplest signal: track a boolean state `geocodeActive`, set `true` the first time `geocodeSuggest` returns `ok` with `suggestions.length > 0` (inside the existing `queueAddressSuggestions` success path), and render the attribution line only when `geocodeActive` is true (so it appears once the provider proves live and stays visible while the operator works the address). Do NOT show it in the no-key path.
- Don't disrupt the combobox keyboard nav / dropdown positioning — place the attribution as a static line below, not inside, the listbox.

## Out of scope
No change to the provider seam, server actions, or persistence. No attribution on unrelated pages (only the add-property address field surfaces geocoding today).

## DONE criteria
`npx tsc --noEmit`, `npm run lint` (known job-page `<img>` advisory allowed), `npm run build`, `git diff --check` clean. Existing tests unaffected (this is presentational; no new pure logic to test — if you extract any helper, add a case). With no key: attribution does not render (verify the `geocodeActive` gate). Commit: `feat: add Geoapify/OpenStreetMap attribution to address autocomplete (lane B2)`. Reply branch/SHA/diffstat. Do NOT push.

## Cowork warm-verify + go-live
Diff confined to `add-property-form.tsx`. Cowork confirms the line renders under the Address field on the live QA org once autocomplete returns a suggestion, links open correctly, and it's absent when autocomplete is inactive. Then Noam pushes → auto-deploys.
