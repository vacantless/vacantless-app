# CODEX BUILD — S615 Lane B2: address autocomplete + geocoding (latitude/longitude) with a provider seam

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-02
**Type:** enhance the Lane B add-property flow so the Address field autocompletes and the created row carries `latitude`/`longitude`. Builds ON Lane B (commit d7a4861, flag `ADD_PROPERTY_V2_ENABLED`).
**Migration:** none — `latitude`/`longitude` `double precision` columns already exist (mig 0206) and are already SELECTed by `get_org_listing_feed`/`get_network_listing_feed`.
**Flag / config:** no new feature flag. Autocomplete lives only inside the V2 add-property surface (already gated by `ADD_PROPERTY_V2_ENABLED`). Provider is chosen by env `GEOCODE_PROVIDER` (default `radar`) + a server-only key. **With no key set, the whole feature no-ops and the Address field behaves byte-for-byte like today** (plain text input, `latitude`/`longitude` written null). This is the graceful-degradation requirement — it must ship and pass with NO key configured.
**Risk:** low. New pure module + one server action + one field upgrade + one insert change, all inside the flagged V2 flow. Key stays server-side.

> **EGRESS APPROVAL — Noam, 2026-08-02.** Noam explicitly approved wiring Lane B2 so typed or selected rental addresses may be sent to Radar for address autocomplete AND submit-time forward geocoding when `GEOCODE_PROVIDER`/`RADAR_API_KEY` are enabled. Scope = the add-property V2 flow only; no egress when the key is unset (Null provider). This clears the patch-guard block on the Radar flow. Full autocomplete (not submit-only) is approved.

## Provider decision (already made — build to this)
Default provider = **Radar**. Chosen over Google Places and Mapbox because we **persist** the coordinates to `properties.latitude/longitude` and push them onward (Meta catalog + map pin): Radar's terms permit storing geocoded coordinates, its free tier (~100k reqs/mo) comfortably covers a self-serve rental tool, and its REST autocomplete + forward-geocode fit a clean server seam with no map-display coupling. Google Places has the best autocomplete/coverage but its terms restrict persisting/displaying results outside a Google map and it needs a billing account; Mapbox requires the paid "permanent geocoding" tier to store coordinates. **Build a provider seam** so Google can be dropped in later behind the same interface by switching `GEOCODE_PROVIDER` — do NOT hardwire Radar throughout.

---

## Standing rules (same loop)
- **Warm-verify FIRST**, read before touching:
  - `app/dashboard/properties/actions.ts` — `createPropertyV2`@647 (the insert currently hardcodes `latitude: null, longitude: null`@~720; that is the line this lane replaces) and `prefillAddPropertyV2`@531 (the server-action-from-client pattern to mirror).
  - `app/dashboard/properties/new/add-property-form.tsx` — the Address `<input name="address">` (~L482) inside the "Core" section, and the existing `useTransition`/`applyPrefill` client pattern.
  - `lib/env.ts` (or wherever `envFlagEnabled` lives) for the env-reading helper style.
  - Any existing outbound-HTTP lib for house style on `fetch` + timeout + error handling (e.g. the QUO/SMS or vision-import libs).
- Codex **builds + verifies + commits by name.** Do NOT push. Do NOT apply anything (no migration). Cowork warm-verifies vs prod, Noam pushes + sets the key, then dogfoods.
- Reuse existing helpers/normalizers; match house style. No new dependency unless unavoidable (use global `fetch`; do NOT add a provider SDK).
- Gates: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `git diff --check`, all pure tests green. Report branch, SHA, diffstat, test counts.

---

## Scope

### 1. New provider seam — `lib/geocode.ts`
Pure contract + provider selection. The impure HTTP call is the only network part; keep it thin and injectable so the module unit-tests without network.

```ts
export type GeocodeSuggestion = {
  label: string;              // human-readable, e.g. "123 Main St, Toronto, ON"
  latitude: number | null;    // some providers return coords with the suggestion
  longitude: number | null;
  providerId: string | null;  // opaque id for a follow-up detail call if needed
};
export type GeocodeResult = {
  latitude: number;
  longitude: number;
  formattedAddress: string | null;
};
export interface GeocodeProvider {
  readonly name: string;
  autocomplete(query: string, signal?: AbortSignal): Promise<GeocodeSuggestion[]>;
  geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult | null>;
}
```

- **Pure helpers (unit-tested, no network):**
  - `isValidLatLng(lat, lng): boolean` — finite, lat ∈ [-90,90], lng ∈ [-180,180]; reject `0,0`.
  - `parseLatLng(latRaw, lngRaw): { latitude: number; longitude: number } | null` — tolerant parse of the hidden form fields, validated via `isValidLatLng`.
  - `resolveGeocodeProviderName(env): "radar" | "google" | "mapbox" | "none"` — returns the configured provider ONLY when its key is present, else `"none"`. Default provider name = `radar`.
  - Radar response normalizers: `normalizeRadarAutocomplete(json)` → `GeocodeSuggestion[]`, `normalizeRadarGeocode(json)` → `GeocodeResult | null`. Country-bias CA; drop entries without valid coords.
- **`getGeocodeProvider(env = process.env): GeocodeProvider`** — factory. When `resolveGeocodeProviderName` is `"none"`, return a `NullGeocodeProvider` whose `autocomplete` returns `[]` and `geocode` returns `null` (never throws, never fetches). When `radar`, return `RadarGeocodeProvider` calling Radar's REST autocomplete + forward-geocode endpoints with the server-only key, an `AbortSignal` timeout (~4s), and try/catch that degrades to `[]`/`null` on any non-2xx/parse/network error (never throw to callers). `google`/`mapbox` may be left as `throw new Error("provider not implemented")` stubs behind the same interface — the seam is the deliverable, not a second live provider.
- Key env names: `RADAR_API_KEY` (provider `radar`). Read the key ONLY inside the provider module (server). Never reference it from a client component.

### 2. Server actions — in `app/dashboard/properties/actions.ts` (mirror `prefillAddPropertyV2`)
- `geocodeSuggest(formData | query: string): Promise<{ ok: true; suggestions: GeocodeSuggestion[] } | { ok: false }>` — `requireCapability("manage_properties", …)`, then `getGeocodeProvider().autocomplete(query)`; debounce/guard empty/short queries server-side (return `[]` for < 3 chars). Cheap, no DB write.
- `geocodeResolve(query: string): Promise<GeocodeResult | null>` — single forward geocode; used as the submit-time fallback (below). Guarded, never throws.
- Both re-check `envFlagEnabled(process.env.ADD_PROPERTY_V2_ENABLED)` (defense in depth) and return the empty/no-op shape when off.

### 3. Address field upgrade — `app/dashboard/properties/new/add-property-form.tsx`
- Turn the Address `<input>` into an **autocomplete combobox**: on change (debounced ~250ms, min 3 chars) call `geocodeSuggest` inside a `useTransition`; render suggestions in a listbox under the field. On select: set `draft.address` to the suggestion label, and set hidden inputs `latitude`/`longitude` from the suggestion coords (if present). Keep it keyboard-accessible (arrow/enter/escape) and match existing input styling (`inputClass()`).
- Add `<input type="hidden" name="latitude">` + `<input type="hidden" name="longitude">` bound to draft state. Editing the address text after a selection **clears** the hidden coords (so stale coords never ride along with a hand-edited address).
- **Graceful degradation:** when the provider is `none`, `geocodeSuggest` returns `[]`, the listbox never appears, and the field is exactly the current plain input. No visual or behavioral change without a key. Do not show provider errors to the operator — a failed lookup silently yields no suggestions.
- Do NOT couple this to the Import/Start-fresh toggle — autocomplete applies to the address field in both modes.

### 4. Persist coordinates — `createPropertyV2` insert (`actions.ts`@~720)
Replace the hardcoded `latitude: null, longitude: null` with a resolver:
1. If the hidden `latitude`/`longitude` form fields parse valid (`parseLatLng`) → use them.
2. Else, **best-effort** `await geocodeResolve(address)` server-side (covers the operator who typed an address without picking a suggestion). Wrap in try/catch → on null/error, fall back to `null`/`null`.
3. Never let a geocode failure block or slow the create beyond the provider's own ~4s timeout; a null result is a first-class, expected outcome (today's behavior).

### 5. Tests — `scripts/test-geocode.ts` (pure, no network)
- `resolveGeocodeProviderName`: no key → `"none"`; `RADAR_API_KEY` set → `"radar"`; explicit `GEOCODE_PROVIDER=google` without a google key → `"none"`.
- `getGeocodeProvider` with empty env returns the Null provider and its `autocomplete`/`geocode` resolve to `[]`/`null` (assert no throw).
- `isValidLatLng` / `parseLatLng`: accept Toronto (43.65, -79.38); reject `0,0`, out-of-range, `NaN`, empty strings.
- `normalizeRadarAutocomplete` / `normalizeRadarGeocode` against a captured sample JSON literal (inline fixture, no network): maps fields, drops coord-less rows, biases valid CA result.
- Keep every existing test green. Register the new script in whatever runner the repo uses (mirror how `scripts/test-add-property-v2.ts` is wired).

**Out of scope this lane (note, do not build):** editing an existing property's address on `/dashboard/properties/[id]` (= Lane B3, optional later); a live map preview; reverse geocoding; a second live provider (Google/Mapbox stubs only).

---

## DONE criteria
`npx tsc --noEmit`, `npm run lint` (known job-page `<img>` advisory allowed), `npm run build`, `git diff --check` all clean; pure tests green with counts. **With no `RADAR_API_KEY` set:** the V2 add form's Address field is unchanged, `geocodeSuggest` returns `[]`, and `createPropertyV2` writes `latitude`/`longitude` null exactly as today. Commit: `feat: address autocomplete + geocoding via provider seam (lane B2)`. Reply with branch, SHA, diffstat, test counts. Do NOT push.

## Cowork warm-verify + go-live (after Codex)
1. Diff scope confined to `lib/geocode.ts` (new), the two server actions, the Address field in the V2 form, the `createPropertyV2` insert line, and the new test. Nothing outside the V2 surface; no migration.
2. Re-run pure tests in the cloud; confirm the no-key path (Null provider) is what the suite exercises by default.
3. Confirm graceful degradation with no key: `/dashboard/properties/new` Address field renders + saves; row written with null coords.
4. Go-live: Noam adds `RADAR_API_KEY` (and optionally `GEOCODE_PROVIDER=radar`) in Vercel — **Noam types the value (KI988)** — redeploy. Dogfood on a QA org: type a partial Toronto address → suggestions appear → pick one → hidden coords set → save → SQL readback shows `latitude`/`longitude` populated on the row. Then type an address without picking → save → submit-time geocode fills coords. Delete the QA row after.

---
_Loop: Codex builds → Cowork warm-verifies → (no mig) → Noam file-scoped push → Noam sets the key + redeploy → dogfood. Follow-up B3 = same seam on the existing-property edit path._
