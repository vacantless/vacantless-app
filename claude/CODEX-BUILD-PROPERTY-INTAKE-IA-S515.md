# CODEX BUILD — Property intake / setup IA rework (S515, "A+")

**Type:** UI-only refactor. **NO migration. NO RPC change. NO save-model change. No input `name` renamed.**
**Repo:** `vacantless-app` (Next.js App Router). **Base:** `main` @ `50485a4`.
**Verified against live code by Cowork 2026-07-18** — every file/line reference below was read at this HEAD.

---

## Why (the dogfood problem)

Noam, using the product 2026-07-18: adding a rental captures minimal fields, then you go back in to "complete" it — and completion is a confusing **third** tab. On the property detail page the tabs render **Photos & listing copy → Distribute → Set up → Assets → Inquiries**, so the CORE unit fields sit on the 3rd tab, *after* Distribute, in a ~600-line wall. The lifecycle spine (`lib/rental-lifecycle.ts:26`) already sequences `set_up → market → inquiries → …`; only the rendered tab order disagrees.

Three defects: **P1** a fresh add (without photos) bounces you back to the list instead of into the unit; **P2** tab order contradicts the lifecycle (Set up is 3rd, behind Distribute); **P3** the Set-up panel is one long undifferentiated form. Plus a **stale link** in Distribute that sends the operator to the wrong place to finish setup.

This is the **A+, cheap slice**: reorder + relabel + chunk + fix links + land fresh creates in the unit. No wizard, no schema change.

---

## The five changes

### 1. Reorder the tabs — Unit details first
**File:** `app/dashboard/properties/[id]/page.tsx`, inside `<TabbedSections initialTab={defaultTab}>` (opens line **1695**, closes **2892**).

Current child order (each a `<TabPanel>`):
| # | line | tabId | label | anchorId |
|---|------|-------|-------|----------|
| 1 | 1697 | `market` | `Photos & listing copy` | — |
| 2 | 2153 | `distribute` | `Distribute` | `distribute` |
| 3 | 2181 | `setup` | `Set up` | `rental-details` |
| 4 | 2785 | `assets` | `Assets` | — |
| 5 | 2842 | `inquiries` | `Inquiries` | `inquiries` |

**Move the entire `setup` TabPanel block (lines 2181–2784) to be the FIRST child**, immediately before the `market` TabPanel at 1697. Final order:

`setup → market → distribute → assets → inquiries`

- Keep `tabId="setup"` and `anchorId="rental-details"` **unchanged**.
- Change **only its label**: `label="Set up"` → `label="Unit details"`.
- Do not touch the inner JSX of any panel — this is a pure move + one label string.

**Why this is safe:** `tabbed-sections.tsx` derives tab order from the child order (`Children.toArray`), resolves deep-links by `document.getElementById(id).closest("[data-tabpanel]")` and activates that panel — so order is driven entirely by child position and anchors keep resolving as long as ids are unchanged. `firstTab` (the fallback when `initialTab` isn't a known tabId) becomes `"setup"`, which is the desired default landing.

### 2. `defaultTab` — no logic change, just confirm
**File:** same, lines **1440–1446**.
```
const defaultTab = setUpOpen ? "setup" : marketOpen ? "market" : inquiriesOpen ? "inquiries" : "market";
```
`"setup"` is still a valid tabId, so a unit at the `set_up` frontier still opens on Unit details. No edit required. (Just re-verify after the move that `defaultTab` still compiles and `validInitial` resolves.)

### 3. Land every fresh create on the detail page, Unit details active
**File:** `app/dashboard/properties/actions.ts`, `addProperty`, line **210** (the no-photos branch).

Currently:
```ts
redirect(`/dashboard/properties?added=${Date.now().toString(36)}`);   // -> back to the LIST (P1 round-trip)
```
Change to land in the new unit with the Unit-details panel active:
```ts
if (newId) {
  redirect(`/dashboard/properties/${newId}?created=1#rental-details`);
}
// insert failed (no id) — keep the old list redirect so we never build /properties/null
redirect(`/dashboard/properties?added=${Date.now().toString(36)}`);
```
- The `#rental-details` fragment makes `TabbedSections` activate the Unit-details panel on load (its `anchorId`), **regardless** of the lifecycle default — belt and suspenders.
- The WITH-photos branch (lines 194–201) already lands on the detail page — **leave it unchanged**.
- The old `?added=` NONCE existed to remount the add form and clear its uncontrolled inputs (S192/S226). That concern is moot here because we navigate **away** from the list route entirely, so the form unmounts.

Add a `created` success banner in `page.tsx` alongside the existing `searchParams.saved` / `?photos` banners (search for `searchParams.saved` ~line 1455), e.g.:
> "Rental created. Finish the unit details below, then publish."

### 4. Fix the stale "Finish setup" link in Distribute
**File:** `app/dashboard/properties/[id]/distribute-tab.tsx`, lines **330–332**.

Currently (shown when `!readyToShare`):
```tsx
<a href="#share" className="font-medium text-brand underline">
  Finish setup in Photos &amp; listing copy →
</a>
```
The required fields that gate sharing (rent / beds / baths) live in the **Unit details** tab under `#rental-details`, not in the `#share` block (which is inside the Photos & listing copy tab). Change to:
```tsx
<a href="#rental-details" className="font-medium text-brand underline">
  Finish setup in Unit details →
</a>
```
Deep-link resolves: `#rental-details` is the Unit-details panel's `anchorId`, so the click switches tabs and scrolls. **Only this one link** matches the pattern in the detail dir. Leave the `#property-photos` links at `page.tsx:1579` and `:1812` untouched — those correctly point at photos in the market tab.

### 5. Chunk the Set-up form (presentational only)
**File:** `page.tsx`, the setup TabPanel body (now moved to first; originally lines 2181–2784).

Keep it **ONE `<form>`** posting to the existing `updateProperty` server action — no save-model change, no `name=` change, no field added/removed. Break the ~600-line wall into a few labelled card sub-sections with headings so it reads as a short checklist instead of a scroll. Suggested grouping (adjust to taste, but preserve order-independence of anchors):

- **The unit** — address (`#property-address`), rent (`#property-rent`), beds (`#property-beds`), baths (`#property-baths`), parking (`#property-parking`), status (`#property-status`)
- **Showings** — showing instructions (`#property-showing-instructions`), arrival phone (`#property-showing-arrival-phone`)
- **Listing description** — the `#listing-description` block + `<DescriptionGuide … name="description">` (unchanged)
- **More details** — available date (`#property-available-date`), sqft (`#property-sqft`), floor (`#property-floor`), laundry (`#property-laundry`), virtual tour (`#virtual_tour_url`), pets notes (`#property-pets-notes`)

**Preserve every existing `id=` anchor and every input `name`.** Purely visual grouping (cards + `<h3>` headings). The `#rental-details` wrapper anchor stays on the panel (it's the TabPanel `anchorId`).

### 6. (Recommended, contained) Match the lifecycle-rail label
For one vocabulary across the rail and the tab: in `lib/rental-lifecycle.ts` change `STEP_LABELS.set_up` from `"Set up"` to `"Unit details"`, and update the corresponding assertion in `scripts/test-rental-lifecycle.ts` **intentionally** (pure-function label test). If you'd rather keep the surface minimal, skip this — but then the rail says "Set up" while the tab says "Unit details"; call that out if you leave it.

---

## Guardrails
- **UI-only.** No migration, no RPC, no change to `updateProperty` or any input `name`, no listing-quality relocation, no create wizard.
- **Stable tabIds:** `setup`, `market`, `distribute`, `assets`, `inquiries` — unchanged.
- **Stable anchors:** `#rental-details`, `#listing-description`, `#share`, `#property-photos`, `#distribute-header`, `#inquiries`, `#detectors` / `#equipment` / `#appliances`, and every `#property-*` field id.
- Final tab bar reads: **Unit details · Photos & listing copy · Distribute · Assets · Inquiries.**

## Test plan
1. `npm run build` and `tsc` clean.
2. If change 6 applied: `npx tsx scripts/test-rental-lifecycle.ts` — one label assertion updated on purpose, rest green.
3. Manual QA:
   - Fresh add **without** photos → lands on the new property's detail page, **Unit details** tab active, "created" banner shows.
   - Fresh add **with** photos → unchanged (detail page + `?photos` banner).
   - Deep-links still switch tabs: a rail step click and the Distribute "Finish setup in Unit details →" link both activate Unit details and scroll to `#rental-details`.
   - `#share` and `#property-photos` still resolve inside the Photos & listing copy tab.
   - Distribute readiness chip + "Finish setup" link now point at Unit details when rent/beds/baths are missing.

## Out of scope (do NOT do here)
- Create wizard (Option B) — only if dogfood still shows re-entry pain after this ships.
- MLS/PDF import re-flow (import stays a prefill/entry mode, not a forced step 1).
- Moving/relabelling listing-quality, or any Distribute content change beyond the one stale link.
- Any DB or server-action behavior change.

## Return
A unified `git diff` (expected files: `app/dashboard/properties/[id]/page.tsx`, `app/dashboard/properties/actions.ts`, `app/dashboard/properties/[id]/distribute-tab.tsx`, and — if change 6 — `lib/rental-lifecycle.ts` + `scripts/test-rental-lifecycle.ts`), plus the `tsc`/build result and the rail test result. Do not push.
