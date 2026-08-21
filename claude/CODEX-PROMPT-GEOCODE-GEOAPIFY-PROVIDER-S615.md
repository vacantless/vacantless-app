# CODEX BUILD — S615 Lane B2 follow-up: add a Geoapify provider to the geocode seam

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-02
**Type:** small addition to the existing provider seam (`lib/geocode.ts`, shipped in commit 9bd89be). Implements a real second provider — **Geoapify** — because Radar turned out to be sales-gated (no self-serve key). Geoapify is card-free, instant self-serve, 3,000 req/day free, and permits storing coordinates.
**Migration:** none.
**Flag/config:** provider chosen by `GEOCODE_PROVIDER=geoapify` + `GEOAPIFY_API_KEY`. Still ships dark: no key → `resolveGeocodeProviderName` returns `"none"` → Null provider, address field unchanged. Radar path stays intact (unused).
**Risk:** very low. One new provider class + wiring + tests, all inside the existing seam. No UI change (the Address combobox already consumes the seam via `geocodeSuggest`/`geocodeResolve`).

## Warm-verify first
Read `lib/geocode.ts` in full (the seam from 9bd89be): `GeocodeProvider` interface, `RadarGeocodeProvider` (mirror it), `resolveGeocodeProviderName`, `getGeocodeProvider`, the pure helpers (`isValidLatLng`, `parseLatLng`, `cleanText`, `numberValue`, `recordValue`), and `scripts/test-geocode.ts`.

## Scope — `lib/geocode.ts`

### 1. `GeoapifyGeocodeProvider implements GeocodeProvider` (mirror `RadarGeocodeProvider`)
- `name = "geoapify"`, constructor takes the API key.
- Base URL `https://api.geoapify.com/v1/geocode`. Same private `request()` shape as Radar: `AbortController` ~4s timeout, honor the passed `signal`, `cache: "no-store"`, try/catch → return `null` on non-2xx / parse / network error (never throw to callers).
- **Key is a query param** (`apiKey`), not a header — Geoapify's convention. It stays server-side (this module is server-only; never imported into a client component — the client uses the `geocodeSuggest` server action + a type-only import, keep it that way).
- `autocomplete(query, signal)`: `q = query.trim()`; `< 3` chars → `[]`. GET `/autocomplete?text={q}&filter=countrycode:ca&limit=6&apiKey={key}` → `normalizeGeoapifyAutocomplete(json)`.
- `geocode(query, signal)`: `q = query.trim()`; `< 3` → `null`. GET `/search?text={q}&filter=countrycode:ca&limit=1&apiKey={key}` → `normalizeGeoapifyGeocode(json)`.

### 2. Response normalizers (pure, exported, unit-tested) — Geoapify returns GeoJSON FeatureCollection
- Shape: `{ features: [ { properties: { formatted, lat, lon, place_id, address_line1, address_line2, city, state, postcode, country_code }, geometry: { coordinates: [lon, lat] } } ] }`.
- `normalizeGeoapifyAutocomplete(json): GeocodeSuggestion[]` — iterate `features[].properties`; coords via `parseLatLng(p.lat, p.lon)` (fallback to `geometry.coordinates[1]`, `[0]`); `label` = `cleanText(p.formatted)` (fallback: join `address_line1`,`address_line2` or `address_line1`,`city`,`state`,`postcode`); `providerId` = `cleanText(p.place_id)`. Drop entries with no valid coords or no label; dedupe like the Radar normalizer.
- `normalizeGeoapifyGeocode(json): GeocodeResult | null` — first feature with valid coords → `{ latitude, longitude, formattedAddress: label }`, else `null`.
- Reuse `parseLatLng`/`isValidLatLng`/`cleanText`/`recordValue` — do not duplicate.

### 3. Wire the selector + factory
- `resolveGeocodeProviderName`: add a `geoapify` branch — return `"geoapify"` when `cleanEnv(env.GEOAPIFY_API_KEY)` is set, else `"none"`. (Default provider name stays whatever it is; selection is by explicit `GEOCODE_PROVIDER` + key presence.)
- `getGeocodeProvider`: when resolved name is `"geoapify"`, return `new GeoapifyGeocodeProvider(key)` (key present by construction; defensive `?? NullGeocodeProvider`).
- Leave Radar + the Google/Mapbox stubs exactly as they are.

### 4. Tests — extend `scripts/test-geocode.ts` (pure, no network)
- `resolveGeocodeProviderName`: `GEOCODE_PROVIDER=geoapify` + `GEOAPIFY_API_KEY` set → `"geoapify"`; `geoapify` without key → `"none"`.
- `getGeocodeProvider` with `{GEOCODE_PROVIDER:"geoapify", GEOAPIFY_API_KEY:"x"}` returns a provider whose `name === "geoapify"`.
- `normalizeGeoapifyAutocomplete` / `normalizeGeoapifyGeocode` against an inline Geoapify FeatureCollection fixture (a Toronto result): maps formatted/lat/lon/place_id, drops coord-less features, biases valid result. Keep the existing Radar cases green.

## DONE criteria
`npx tsc --noEmit`, `npm run lint`, `npm run build`, `git diff --check` clean; `test-geocode` green with the new cases (report the new count). With no key: `resolveGeocodeProviderName` → `"none"`, Null provider, address field unchanged. Commit: `feat: add Geoapify provider to geocode seam (lane B2)`. Reply branch/SHA/diffstat/test count. Do NOT push.

## Cowork warm-verify + go-live
1. Diff confined to `lib/geocode.ts` + `scripts/test-geocode.ts`. No UI/action/migration change.
2. Re-run `test-geocode` in the cloud (2-file closed set — stageable).
3. Confirm no-key path = Null provider.
4. Go-live: Noam pushes → sets `GEOCODE_PROVIDER=geoapify` + `GEOAPIFY_API_KEY` in Vercel (Noam types the key value, KI988; the earlier RADAR_API_KEY form is discarded) → redeploy → Cowork dogfoods live autocomplete on the QA org, confirms coords land on a saved draft. Add the required Geoapify/OSM attribution link where geocoding surfaces (small follow-up).
