# DESIGN / SCOPING — Property add → set up → publish → distribute IA (S515)

**Status: SCOPING (design only, no build).** Date: 2026-07-18 (session 514/515).
For a dual review: Cowork wrote this; Codex reviews independently (see
`claude/CODEX-REVIEW-PROPERTY-INTAKE-SETUP-IA-S515.md`). Nothing is prejudged — all three
options are on the table; a recommendation is offered but the review + Noam decide.

App HEAD: current main (S513a/S514/S513b live). No migration implied by this doc.

---

## 1. The problem (Noam, 2026-07-18, from using it)

"It's confusing to add a property with minimal details and then have to go in and edit it in a
later step, and that edit step is third in the process. It's doable but a little hard to
understand. And the edit page is good but long." And: "Photos & listing copy looks like the
first step, but the actual set-up is under 'Set up,' which sits *after* Distribute."

## 2. Current flow (verified 2026-07-18 via device_bash git)

**Add (thin).** `app/dashboard/properties/page.tsx` → `addProperty` requires only an address
(rent/beds/baths optional) and creates the unit as `status='draft'` (PRIVATE until reviewed —
a deliberate S371 guard). Import paths exist: MLS-PDF (`importPropertyFromMls` / `MlsPdfImport`),
images (`importListingFromImages` / `ListingImageImport`, currently DARK, billing-gated), and a
copy intake (`CopyIntakeButton`). So every add sends the operator back in to complete the unit.

**Complete/edit (long, mis-ordered).** `app/dashboard/properties/[id]/page.tsx` renders a
`TabbedSections` with tabs in this left-to-right order:

1. **Photos & listing copy** (`tabId="market"`) — photo manager + the per-portal `ListingCopyCard`.
2. **Distribute** (`tabId="distribute"`) — distribution channel cards + feed.
3. **Set up** (`tabId="setup"`) — the CORE unit fields: address, rent, beds/baths, parking,
   status, showing instructions + arrival phone, the description + guided writer, virtual tour,
   then fieldsets for availability (available_date / sqft / floor / laundry), pets, utilities,
   and policies. **~600 lines in one panel.**
4. **Assets** (`tabId="assets"`) — detectors / equipment / appliances (maintenance surface).
5. **Inquiries** (`tabId="inquiries"`).

**Lifecycle model.** `lib/rental-readiness.ts` defines four readiness signals shown as chips on
the Rentals list — **Link** (public page live + bookable), **Photos**, **Viewings** (org can
self-book), **Feed** (syndicating). The detail-page tabs carry a `done` check tied to lifecycle
steps (market/setup/inquiries steps; distribute = has a channel). Publish (draft → available)
is a separate action (`isPublishStatus` et al.).

## 3. The three problems, isolated

- **P1 — thin add forces a round-trip.** You create an address-only draft, then must navigate
  into the unit to make it real. The "add" and "make it real" are two disjoint steps.
- **P2 — tab order contradicts the lifecycle.** Core setup is the 3rd tab, and **Distribute
  (step 2) precedes Set up (step 3)** — you're invited to distribute a unit you haven't set up.
  This is the single most confusing thing and the cheapest to fix.
- **P3 — the Set up panel is one long wall** (~600 lines, ~7 field groups) with no internal
  chunking, so completing a unit is a scroll-heavy slog.

## 4. Three options (per Noam: scope all three, decide after)

### Option A — Light: reorder + declutter
- **Reorder** the tabs to match the lifecycle: **Set up → Photos & listing copy → Distribute →
  Assets → Inquiries.** Rename "Set up" to something that reads as step one (e.g. "Unit details"
  or "The unit").
- **Chunk** the long Set up panel into a few collapsible sub-sections (Basics · Description ·
  Availability & features · Pets & utilities · Policies · Showing logistics), each a `<details>`
  or sub-card, so it's scannable and resumable.
- Optional: a compact "what's left" strip at the top of the detail page reflecting the readiness
  lifecycle (Details → Photos → Publish → Distribute) so the sequence is visible.
- **Effort:** small (mostly JSX reorder + section wrappers). **Risk:** low. **Win:** removes P2
  entirely and most of P3. Does not touch P1 (add stays thin).

### Option B — Medium: front-load a create wizard
- Replace the thin quick-add with a short **guided create flow** that captures the core details
  up front (address, rent, beds/baths, key features, description via the guided writer, first
  photos), **optionally seeded by the MLS/PDF import** (the import becomes the wizard's step 1).
  On finish, land on a unit that's already mostly set up; the detail page becomes refine +
  publish + distribute.
- Keep a "quick add / skip" escape hatch for power users who want to paste an MLS PDF and tweak.
- **Effort:** medium-large (new multi-step create UI + import wiring + validation). **Risk:**
  medium. **Win:** removes P1 (no round-trip). Best paired with A's reorder for the detail page.

### Option C — Full: rethink the whole journey
- Redesign **add → complete → publish → distribute as one staged flow** with a persistent
  progress rail, merging B's wizard with a reorganized detail experience, and reconciling the
  lifecycle model end-to-end (possibly collapsing the 5 tabs into a guided steps rail + a details
  surface; deciding where Assets/Inquiries — post-publish management — belong).
- **Effort:** large. **Risk:** higher (touches the whole property surface). **Win:** most
  coherent operator experience; warranted only if the tabbed model is judged fundamentally off.

## 5. Recommendation (Cowork)

**Ship A first, then evaluate B; park C.** Rationale: A fixes P2 (the backwards order that Noam
actually tripped on) and most of P3 at near-zero risk and small effort — the biggest clarity win
per hour. The create-wizard (B) is the right answer to P1 but is a real build and a behavior
change; do it as a fast-follow *if* the round-trip still bites after A, or if intake volume makes
it worth it. C is over-investment unless the review surfaces a deeper structural problem. Staging
this way also lets the dual review calibrate ambition against what A reveals in practice.

## 6. Open questions for the Codex review (§ mirrors the review prompt)

1. Is the tab reorder as safe as it looks? Check `TabbedSections` for `initialTab`, deep-link/
   anchor handling (`section-deeplink-opener`), and any lifecycle `done` logic that assumes the
   current child order.
2. Is there an intentional reason Distribute precedes Set up today that we're missing?
3. Rename "Set up" — to what, and does anything key off the `tabId="setup"` string?
4. For B: should the MLS/PDF import *be* the wizard's first step, or stay a separate entry?
5. Where do Assets + Inquiries belong — in the setup sequence, or clearly separated as post-
   publish management (leave them last)?
6. Anything this scoping missed — a fourth option, a hidden coupling, a cheaper win?

---

## ADDENDUM - Codex review folded + RECONCILED (2026-07-18)

Codex reviewed this doc at HEAD 50485a4 (review-only). Corrections to the current-state map:
- `CopyIntakeButton` is NOT an intake/import path - it's "Copy inquiry link" for live bookable rows. Strike it from the add/intake entries.
- Listing-quality is NOT near the market tab - it's computed on the page + rendered collapsed under Distribute -> "Performance & setup" (`distribute-tab.tsx:449`). Listing copy IS on the market tab (`ListingCopyCard`, page.tsx:1845).
- P1 is overstated: quick-add WITH photos redirects into the detail page; MLS/text/image import land on the detail review page. The genuine round-trip is only "start fresh WITHOUT photos."
- Stronger evidence for P2: `lib/rental-lifecycle.ts:25` ALREADY sequences Set up -> Market -> Inquiries -> Viewings -> Screen -> Lease -> Tenanted; only the rendered tab order disagrees. (`initialTab` can open setup first when lifecycle says setup is current, so it's mostly a visual-order/mental-model bug.)
- NEW bug: Distribute shows a stale "Finish setup in Photos & listing copy" link (-> `#share`) when required share fields are missing, but the missing rent/beds/baths live under `#rental-details`.

**DECISION: adopt A+ (Codex's, Cowork agrees).** Ship as the first ticket:
1. Reorder tabs: **Unit details -> Photos & listing copy -> Distribute -> Assets -> Inquiries.** Rename "Set up" -> "Unit details" (LABEL ONLY; keep `tabId="setup"`).
2. Chunk the Set-up form into collapsible groups - keep ONE form (no save-model change).
3. Fix the stale setup/distribute links: point "finish setup" to `#rental-details`, not `#share`.
4. Make every SUCCESSFUL FRESH CREATE land on the property's detail page with Unit details active (kills the cheap P1 slice, no wizard).

**Guardrails for the build:** UI-only, NO migration. Keep every `tabId` and every anchor stable (`#rental-details`, `#property-photos`, `#listing-description`, `#share`, `#distribute-header`) - `TabbedSections` keys off child props/initialTab/closest `[data-tabpanel]`; child order = visual order + fallback first tab. If lifecycle-rail labels change too, update tests/snapshots intentionally. Assets/Inquiries stay LAST + separated. Option B (create wizard) deferred until dogfood shows re-entry pain; MLS/PDF = a prominent prefill / wizard entry mode, never a forced step 1. Option C parked.

**NEXT: cut the A+ CODEX-BUILD + CODEX-PROMPT from this decision.**
