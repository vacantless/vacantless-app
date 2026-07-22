# CODEX-PROMPT S550 - Disclosure (`<details>/<summary>`) screen-reader semantics

Status: OPTIONAL / LOW PRIORITY. This is a possible accessibility hardening, NOT a
confirmed bug. Phase 0 can legitimately close this ticket with zero code changes.
Hand to Codex only when idle (KI825).

No schema. No migration. No new deps. No live sends. No production writes. UI-only.

---

## Background (what was already checked, s539)

The channel rows in the distribution "Publish checklist" (S549), and the shared
`CollapsibleSection` used across the tenancy and property pages, are all built on
the native `<details>/<summary>` element.

A live pass on app.vacantless.com (Claude-in-Chrome) established:

- KEYBOARD = GOOD. The summaries are natively focusable (`tabIndex 0`); real Enter
  and Space keypresses toggle the row open/closed. Nothing to fix here.
- NO nested interactive controls inside any `<summary>` (no `<button>`/`<a>`/`<input>`
  inside the summary). The dangerous a11y case is absent.
- OPEN QUESTION (screen-reader role): Chrome's accessibility tree, as read by the
  automation tool, exposed the native summaries as role `generic` (i.e. no announced
  "button / collapsed / expanded" state). A controlled 4-variant experiment on the
  live page showed:
    - native `<summary>` with plain text  -> generic
    - native `<summary>` with a `<span>`  -> generic
    - native `<summary>` with a `<div>`   -> generic
    - `<summary role="button" aria-expanded="true">` -> button (announced)
  So the content model (phrasing vs block children) makes NO difference. A
  `div`->`span` refactor would fix nothing. Only explicit ARIA changed the exposure.

IMPORTANT CAVEAT: that `generic` reading came from an automation tool's accessibility
serialization, which is lossy. It is NOT confirmed against a real screen reader.
Chromium is generally documented to announce native `<details>/<summary>` to
VoiceOver/NVDA as a button with a collapsed/expanded state. So the defect may not be
real at all. That is why Phase 0 gates everything.

---

## Phase 0 - CONFIRM THE DEFECT IS REAL (gating; do this first)

Run a real screen reader against a page that uses these disclosures - the property
detail page (`/dashboard/properties/[id]`, "Marketing checklist") and/or the tenancy
detail page (`/dashboard/tenancies/[id]`, which has 14 `CollapsibleSection`s).

- macOS VoiceOver: Cmd+F5, then Tab/VO-navigate onto a section header.
- Windows NVDA: Insert+Down, Tab onto a section header.

Listen for whether the header is announced as a control with state - e.g.
"button, collapsed" / "button, expanded" / "disclosure triangle, collapsed" - and
whether activating it announces the state change.

DECISION:
- If the header IS announced as a button/disclosure with a collapsed/expanded state:
  the disclosures are already accessible. STOP. Make NO code change. Close this ticket
  and record "native `<details>` announces correctly in <SR>/<browser>; the automation
  tool's `generic` reading was a serialization artifact."
- Only if the header is announced WITHOUT any expanded/collapsed state (truly silent
  on state) do you proceed to Phase 1.

---

## Phase 1 - Minimal ARIA hardening, SHARED COMPONENTS ONLY (only if Phase 0 confirms a gap)

Target ONLY the two shared components (they cover 17 call sites - 14 on the tenancy
page, 3 on the property page):

- `components/collapsible-section.tsx`
- `app/dashboard/properties/[id]/collapsible-section.tsx`

(They are near-identical duplicates. Consider having the property-page one re-export
the `components/` one to remove the duplicate, but only if trivial and truly identical
behavior; do not change any visuals.)

Do NOT touch the ~61 ad-hoc `<summary>` sites across 35 files in this phase. If Phase 1
proves out under a real screen reader, a Phase 2 can migrate ad-hoc sites onto the
shared component later. Breadth here is deliberately capped - log that this phase does
NOT cover ad-hoc sites so the coverage limit is explicit.

Approach (verify each choice against the real screen reader from Phase 0; do not add
ARIA blindly):

1. Sync `aria-expanded` to the `<details open>` state. Because native `<details>`
   toggles without JS, add a SMALL client enhancer (a `"use client"` wrapper, or a
   tiny script) that, on mount and on the `<details>` `toggle` event, sets
   `summary.setAttribute("aria-expanded", String(details.open))`. Keep the component
   server-rendered where it is today; the enhancer should progressively enhance and
   degrade gracefully (no JS -> still a working native disclosure).
2. Add `role="button"` on the `<summary>` ONLY if the Phase 0 screen-reader retest
   shows it is needed. Prefer the least ARIA that produces a correct announcement -
   over-annotating a native summary can cause double-announcement ("button button" /
   doubled state) in some SR+browser combos, which is worse than the status quo.
3. Preserve everything else byte-identical: the caret SVG (`aria-hidden`), the title/
   status/done markup and classes, `id` for deep-link anchors, content-stays-in-DOM-
   when-collapsed (so in-page anchors inside a closed section still resolve),
   `defaultOpen`, native keyboard toggle.

---

## Boundaries

- UI-only. No schema, no migration, no new runtime deps, no live sends, no production
  writes, no SMS, no external posting.
- Do NOT change any visible layout, spacing, copy, or colors. A user looking at the
  page must see zero visual difference.
- Do NOT regress: native toggle with JS disabled, keyboard Enter/Space toggle,
  deep-link anchors resolving into collapsed sections, `defaultOpen` behavior.
- Do NOT "fix" the content model by swapping block elements for spans - proven inert.
- Do NOT expand scope to the 61 ad-hoc summaries in this ticket.

---

## Verification (report all)

- The Phase 0 screen-reader result, verbatim (which SR + browser, what was announced
  before and after). This is the real acceptance signal, not an automated tree dump.
- `npx tsx scripts/test-distribution-run.ts`, `npx tsx scripts/test-distribution-copilot.ts`,
  and the tenancy/property page tests if any -> all pass.
- `npx tsc --noEmit` -> pass.
- `npm run lint` -> pass (existing unrelated `<img>` warning in `app/job/[token]/page.tsx`
  is pre-existing, ignore).
- `npm run build` -> pass, static generation count unchanged.
- `git diff --check` -> pass.
- Confirm no visual diff (describe the before/after of one section header).
- State the coverage limit explicitly: shared component only; ad-hoc sites not covered.

## Return

- ACCEPT / NEEDS CHANGES.
- Phase 0 outcome first (this may be the whole answer: "native already announces
  correctly - no change made").
- If Phase 1 was done: findings, file/line refs, the exact ARIA added and WHY the
  screen-reader retest justified it, and whether you would approve commit/push/deploy
  after any fixes. Do NOT commit, push, or deploy - hand back for Noam.
