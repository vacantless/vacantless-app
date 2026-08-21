# CODEX PROMPT - "Add photos" must open a focused uploader, not scroll into the 7,000-line detail page (S662, 2026-08-17)

**Reported by Noam, 2026-08-17, in his words: clicking "Add photos" produces "the worst longest list form."**
He is right, and it is not a perception problem. Priority: real operator friction, no deadline.

## The defect

**Every "Add photos" affordance in the product is a plain anchor to `#property-photos`.** There is no
modal and no dedicated upload route. Confirmed call sites:

| File | Line | Surface |
|---|---|---|
| `app/dashboard/properties/[id]/page.tsx` | 2437 | post-import "Next: add photos" banner |
| `app/dashboard/properties/[id]/page.tsx` | 2658 | next-action card |
| `app/dashboard/properties/[id]/page.tsx` | 3545 | share-readiness checklist |
| `app/dashboard/properties/[id]/distribute-tab.tsx` | 1141 | "Photo boost" nudge |
| `app/dashboard/properties/[id]/distribute-tab.tsx` | 1580 | launch-run checklist item (`href: "#property-photos"`) |

The anchor target is `photo-manager.tsx:378` (`id="property-photos"`), a 607-line component embedded
inside the rental detail page. That page is **3,866 lines**, and it sits beside a **3,066-line**
`distribute-tab.tsx`. So the operator clicks a button captioned "Add photos" and is scrolled into the
middle of a roughly 7,000-line monolithic screen, where the actual file input
(`photo-manager.tsx:506`, `aria-label="Add photos to this rental"`) is one control among dozens.

`section-deeplink-opener.tsx` makes the problem legible in its own comment: the anchor "may live
inside a collapsed section," so the app ships a client enhancer whose job is to force sections open
and scroll, because a bare anchor would otherwise land on a hidden element. That enhancer is a
workaround for the missing modal, not a fix.

## What to build

A focused **photo upload modal**, reachable from every one of the five affordances above.

### 1. New client component `app/dashboard/properties/[id]/photo-upload-modal.tsx`

- Renders a dialog containing ONLY the upload affordance and the current photo strip: the file input,
  the pending-file list, the Upload button, cover selection, and the existing reorder arrows.
- **Reuse `PhotoManager`'s existing server actions and upload path. Do NOT reimplement or fork the
  upload logic**, or the two will drift and only one will get the next bug fix. Extract the shared
  piece into a component both the modal and the inline manager render, rather than copying it.
- Keep the existing copy that is doing real work: the cover-photo explanation, the accepted formats,
  the `10 MB each` limit, and the `(n/24)` count.
- Close on success, and refresh so readiness, the lifecycle rail, and the cover thumbnail update.
  A stale readiness chip after a successful upload is a regression, not a cosmetic issue.

### 2. Convert the five affordances to open the modal

Replace each `<a href="#property-photos">` with a control that opens the modal. **Keep `href` set to
`#property-photos`** and call `preventDefault()` in the handler, so middle-click, no-JS, and
right-click-open still resolve to the inline section. Progressive enhancement, not replacement.

### 3. Preserve the deep-link contract (this is the regression risk)

`#property-photos` must STILL resolve to the inline `PhotoManager`. Other surfaces and any saved
link depend on it, and `tabbed-sections.tsx` documents the contract explicitly.

## No-regression baseline (state these FROM THE CODE, before and after)

- `tabbed-sections.tsx:14-27` - panels stay in the DOM when inactive via the `hidden` attribute
  "so the content STAYS in the DOM when inactive," preserving anchor resolution. Do not switch any
  panel to conditional rendering.
- `tabbed-sections.tsx:25-27` - the full anchor set that must keep resolving: `#share`,
  `#property-photos`, `#rental-details`, `#listing-description`, `#detectors`, `#equipment`,
  `#appliances`, `#inquiries`.
- `section-deeplink-opener.tsx` - its three reveal triggers (mount, `hashchange`, capture-phase
  click) must keep working. Note its comment that Next `<Link>` hash navigation uses `pushState` and
  fires neither `hashchange` nor `popstate`; a naive refactor of the affordances will break the rail.
- `photo-manager.tsx:378` - `id="property-photos"` stays on the inline section.
- `photo-manager.tsx:506` - the file input keeps `aria-label="Add photos to this rental"`. Cowork's
  browser automation finds it by that label; renaming it breaks the upload path used in S662.
- The distribute-tab checklist item at `distribute-tab.tsx:1576-1583` keeps its `done`/`action`
  semantics (`hasPhotos ? "Review" : "Add photos"`).

## Verification

1. `tsc --noEmit` clean (on the Mac; it does not run over the bridge).
2. From each of the five affordances, the modal opens without scrolling the page behind it.
3. Upload through the modal, confirm the photos land, the cover is right, and the readiness chip and
   lifecycle rail update without a manual reload.
4. Deep-link directly to `.../properties/<id>#property-photos` and confirm it still activates the
   correct tab, opens any collapsed section, and scrolls to the inline manager.
5. Middle-click one converted affordance and confirm it still resolves to the inline section.
6. Prove by the OBJECT's row: re-read `property_photos` for the property (count, `is_cover`,
   `sort_order`) after a modal upload. A green readiness chip is presence, not correctness.
7. Live check on a QA sandbox org, **never on Growth Test** (frozen Meta App Review reviewer org).

## Out of scope

Do not attempt to break up `page.tsx` or `distribute-tab.tsx` in this ticket. Their size is the
reason this defect is painful, but splitting a 3,866-line server component while a Meta review is
open is a much larger and riskier change. File it separately.

## Context

Surfaced 2026-08-17 (S662) while adding 13 photos to the newly created 1551 Assumption Unit D
listing (`af6b0aae-d714-4ddf-9c09-cac2b272a922`). Related and already filed:
`CODEX-PROMPT-UNARCHIVE-STATUS-RESTORE-S662.md`.
