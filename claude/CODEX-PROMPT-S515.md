# CODEX PROMPT — S515 property-intake IA rework (full, paste to Codex)

Repo: `vacantless-app` (Next.js App Router). Base: `main` @ `50485a4`. This is a **UI-only** refactor — **no migration, no RPC, no server-action save-model change, no input `name` renamed.** Companion spec (same content, more prose): `claude/CODEX-BUILD-PROPERTY-INTAKE-IA-S515.md`.

## Goal
On the property **detail** page, make the CORE unit fields the first thing the operator sees, land a fresh create inside the unit, and fix a stale "finish setup" link. Reorder the tabs so **Unit details** is first, relabel it, chunk its long form into cards, and fix two navigation issues.

## Files to READ first (for context)
- `app/dashboard/properties/[id]/page.tsx` — the detail page. Tabs live in `<TabbedSections initialTab={defaultTab}>` (opens **1695**, closes **2892**). `defaultTab` derived at **1440–1446**. Success banners near `searchParams.saved` (~**1455**). The setup panel body is **2181–2784**.
- `app/dashboard/properties/[id]/tabbed-sections.tsx` — how tabs work: order comes from child order; deep-links resolve via `document.getElementById(id).closest("[data-tabpanel]")` then activate that panel. Reordering = moving a `<TabPanel>` child; anchors keep working as long as ids are unchanged.
- `app/dashboard/properties/[id]/distribute-tab.tsx` — the stale link at **330–332**.
- `app/dashboard/properties/actions.ts` — `addProperty` (starts **147**); the no-photos redirect is line **210**; the with-photos branch is **194–201**.
- `lib/rental-lifecycle.ts` — `STEP_LABELS` (~**48–56**), sequence at **26** (already `set_up → market → …`).
- `scripts/test-rental-lifecycle.ts` — update only if you rename the rail label (change 6).

## Current tab order (each a `<TabPanel>` in page.tsx)
| # | line | tabId | label | anchorId |
|---|------|-------|-------|----------|
| 1 | 1697 | `market` | `Photos & listing copy` | — |
| 2 | 2153 | `distribute` | `Distribute` | `distribute` |
| 3 | 2181 | `setup` | `Set up` | `rental-details` |
| 4 | 2785 | `assets` | `Assets` | — |
| 5 | 2842 | `inquiries` | `Inquiries` | `inquiries` |

## The changes

**1. Reorder — Unit details first.** In `page.tsx`, move the whole `setup` `<TabPanel>` block (**2181–2784**) to be the FIRST child, before the `market` panel at 1697. Final order: `setup → market → distribute → assets → inquiries`. Keep `tabId="setup"` and `anchorId="rental-details"`; change only its label `"Set up"` → `"Unit details"`. Do not edit any panel's inner JSX.

**2. `defaultTab`** (page.tsx 1440–1446) — no change needed; `"setup"` is still a valid tabId and is now also the first-child fallback. Just confirm it still compiles.

**3. Fresh create lands in the unit.** In `actions.ts`, replace the line-210 no-photos redirect:
```ts
// before:
redirect(`/dashboard/properties?added=${Date.now().toString(36)}`);
// after:
if (newId) {
  redirect(`/dashboard/properties/${newId}?created=1#rental-details`);
}
redirect(`/dashboard/properties?added=${Date.now().toString(36)}`); // insert failed → keep list redirect, never build /properties/null
```
The `#rental-details` fragment makes `TabbedSections` activate the Unit-details panel on load. Leave the with-photos branch (194–201) unchanged. In `page.tsx`, add a `created` success banner alongside the `searchParams.saved` banner, e.g. "Rental created. Finish the unit details below, then publish."

**4. Fix the stale "Finish setup" link.** In `distribute-tab.tsx` **330–332**, the missing required fields (rent/beds/baths) live in the Unit-details tab, not the `#share` block:
```tsx
// before:
<a href="#share" className="font-medium text-brand underline">
  Finish setup in Photos &amp; listing copy →
</a>
// after:
<a href="#rental-details" className="font-medium text-brand underline">
  Finish setup in Unit details →
</a>
```
Change only this link. Leave the `#property-photos` links at page.tsx 1579 and 1812 — they correctly point at photos in the market tab.

**5. Chunk the Set-up form (presentational only).** In the setup panel (now first), keep it ONE `<form>` posting to the existing `updateProperty` action — no field added/removed, no `name` changed. Group the ~600 lines into labelled cards with `<h3>` headings, e.g.: **The unit** (address/rent/beds/baths/parking/status) · **Showings** (showing instructions, arrival phone) · **Listing description** (`#listing-description` + the existing `<DescriptionGuide name="description">`) · **More details** (available date/sqft/floor/laundry/virtual tour/pets notes). Preserve every existing `id=` anchor and input `name`.

**6. (Recommended, contained) Match the rail label.** In `lib/rental-lifecycle.ts` set `STEP_LABELS.set_up` `"Set up"` → `"Unit details"`, and update the matching assertion in `scripts/test-rental-lifecycle.ts` intentionally. If you skip this, note that the rail then says "Set up" while the tab says "Unit details."

## Guardrails
- UI-only. No migration/RPC/save-model change; no input `name` renamed; no listing-quality move; no create wizard; no other Distribute change.
- Keep tabIds stable: `setup`/`market`/`distribute`/`assets`/`inquiries`.
- Keep anchors stable: `#rental-details`, `#listing-description`, `#share`, `#property-photos`, `#distribute-header`, `#inquiries`, `#detectors`/`#equipment`/`#appliances`, every `#property-*`.
- Final tab bar: **Unit details · Photos & listing copy · Distribute · Assets · Inquiries.**

## Verify
1. `npm run build` + `tsc` clean.
2. If change 6: `npx tsx scripts/test-rental-lifecycle.ts` (one label assertion updated, rest green).
3. Manual: fresh add without photos → detail page, Unit details active, "created" banner; fresh add with photos → unchanged; Distribute "Finish setup in Unit details →" and rail clicks activate Unit details and scroll to `#rental-details`; `#share`/`#property-photos` still resolve in the Photos & listing copy tab.

## Return
The full `git diff` (expected: `app/dashboard/properties/[id]/page.tsx`, `app/dashboard/properties/actions.ts`, `app/dashboard/properties/[id]/distribute-tab.tsx`, and if change 6 `lib/rental-lifecycle.ts` + `scripts/test-rental-lifecycle.ts`) plus build/test output. **Do not push.**
