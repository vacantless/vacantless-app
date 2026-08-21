# CODEX PROMPT - Photo upload modal: trap focus, inert the background, restore focus on close (S665)

## Context

`app/dashboard/properties/[id]/photo-upload-modal.tsx` shipped in `680c94d` (S663). It was reviewed
and unit-tested but only exercised live for the first time in S665. The upload path works correctly
and must not change. Two accessibility defects were confirmed against prod - see
`claude/FINDINGS-PHOTO-UPLOAD-MODAL-LIVE-EXERCISE-S665.md` for the full evidence.

Branch from `main` at `680c94d`. Branch name: `codex/s665-photo-upload-modal-focus-trap`.

## The two defects, reproduced live on prod

**1. No focus trap, and the background is not inert.**
Open the dialog, press `Shift+Tab` once from the Close button: focus lands on `A: Review screening ->`
in the page behind. Press `Tab` four times forward: focus lands on `BUTTON: tab-market`, the
"Photos & ad" tab button, **with the dialog still open** - so a keyboard user can swap the content
behind an open modal. Measured live: **86 focusable controls remain reachable** behind the scrim.
`main` carries no `inert` and no `aria-hidden`; `body` carries no `inert`.

**2. Focus is not restored on close.**
Open the dialog from the "3. Photos" next-action card, press Escape: `document.activeElement` is
`<body>`. The trigger does not get focus back, so the operator loses their place in a very long
detail screen.

## What to change

Only `app/dashboard/properties/[id]/photo-upload-modal.tsx` should need to change. Do not touch
`photo-manager.tsx`.

1. **Remember the opener.** When the `PHOTO_UPLOAD_MODAL_EVENT` listener fires, capture
   `document.activeElement` (as `HTMLElement | null`) into a ref before `setOpen(true)`.
2. **Trap Tab inside the dialog.** In the existing `open` effect, extend the `keydown` handler: on
   `Tab`, compute the focusable elements inside the dialog node, and if `Shift+Tab` is on the first
   (or focus is already outside the dialog) move to the last, and if `Tab` is on the last move to the
   first, calling `preventDefault()` in those cases. Query focusables fresh on each keystroke - the
   dialog's contents change as photos upload and delete, so a list captured at open time goes stale.
   Use a standard selector and filter out anything hidden or `disabled`:
   `a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])`.
3. **Make the background inert while open.** Prefer the `inert` attribute on the app shell (the
   `<main>` element that contains the page content) and remove it in the effect cleanup. If applying
   `inert` to an ancestor of the dialog is awkward given the dialog currently renders inside `<main>`,
   the cleaner fix is to **portal the overlay to `document.body`** with `createPortal` and then set
   `inert` on `<main>`. Portalling is acceptable and probably preferable - the overlay is already
   `position: fixed inset-0 z-50`, so moving it changes nothing visually.
4. **Restore focus on close.** In the effect cleanup (or wherever `open` flips to false), call
   `.focus()` on the remembered opener if it is still in the document, with a `?.` guard.
5. Keep everything else exactly as it is: Escape must keep working (`window` listener), backdrop
   click must keep closing, the body scroll lock must keep being restored to its previous value, and
   `onUploadSuccess={() => setOpen(false)}` must stay so the modal still auto-closes after upload.

## Do NOT break these - all verified working live in S665

- Plain primary click opens the dialog and does NOT jump the URL to `#property-photos`.
- Meta/ctrl/shift/alt click does NOT open the dialog and does NOT `preventDefault`, so the
  `href="#property-photos"` fallback survives for cmd-click and for no-JS.
- Upload success order is `router.refresh()` then close (`photo-manager.tsx:298-299`). The page behind
  is already updated when the dialog disappears. Do not reorder or debounce this.
- The dialog opens from a trigger in any tab panel, including one that is not the active tab.
- The modal renders `null` when closed, which is what keeps `#photo-upload-modal-input` from
  colliding with the page's `#photo-upload`. Do not make it render while closed.
- Delete must NOT auto-close the dialog.

## Tests

Extend `scripts/test-photo-upload-modal.ts`. Keep every existing assertion passing and add pure-logic
coverage for the new focusable-element selection and wrap arithmetic (first -> last on `Shift+Tab`,
last -> first on `Tab`, empty list is a no-op, hidden and disabled elements excluded). Follow the
existing file's harness style. Report the pass/fail count.

## Gate

Run the repo's build and the full script suite before handing back, and state the numbers. Note that
`npx tsx` and `next build` cannot run on the Mac bridge (linux arm64 VM against darwin-only
`node_modules/@esbuild/`), so run them in your own environment and report the actual output rather
than asserting success.

## Commit

One labelled commit on the branch:
`S665: trap focus in the photo upload modal and restore it on close`
Do not merge. Leave the branch for review.
