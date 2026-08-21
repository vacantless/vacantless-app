# FINDINGS - Photo upload modal, first live exercise (S665)

_2026-08-18. Tree on `680c94d` (`main`), no code changed. All work read-only against prod code plus
one upload-and-delete round trip in a QA org._

## Why this exists

S663 shipped the focused photo upload modal (`680c94d`) and closed with the caveat that it was
**reviewed and unit-tested but never exercised by a real photo upload**. The handoff said "first real
upload is the check". This is that check.

**Org used: North Star Rentals QA** (`b733a191-30fd-47fe-bd21-731404148026`), property
**506 Manning Avenue, Toronto** (`11111111-1111-4111-8111-111111111103`), `status='available'`,
**0 photos at baseline**. Agile was NOT touched. Fixture was a labelled throwaway JPEG.
**State restored exactly**: `photo_rows=0`, `storage_objects=0`, `photos_ready=false`,
`status='available'` [verified by reading the rows back after cleanup].

## Baseline stated FROM THE CODE, not from the S663 summary

| Behaviour | Source |
|---|---|
| Plain primary click: `preventDefault` + dispatch `vacantless:open-photo-upload` | `photo-upload-modal.tsx:45-49` |
| Modified click (meta/ctrl/shift/alt, non-zero button) falls through to `href` | `:24-32` |
| `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, h2 "Add photos" | `:102-119` |
| Body scroll lock while open | `:79-80` |
| Escape closes, listener on `window` | `:81-84` |
| Focus moved to Close button one tick after open | `:85` |
| Backdrop click closes when `target === currentTarget` | `:97-99` |
| Modal renders `null` while closed | `:92` |
| Modal file input id is `photo-upload-modal-input`, page default is `photo-upload` | `:136`, `photo-manager.tsx:135` |
| On upload success: `router.refresh()` THEN `onUploadSuccess()` | `photo-manager.tsx:298-299` |
| `onUploadSuccess` closes the modal | `photo-upload-modal.tsx:140` |

## Results

| # | Test | Result |
|---|---|---|
| T1 | Plain click opens the dialog, `location.hash` stays empty | **PASS** |
| T2 | Focus lands on the Close button, inside the dialog | **PASS** |
| T3 | Focus trap | **FAIL - confirmed defect, worse than documented** |
| T4 | Escape closes, body overflow restored | **PASS** (works even with focus outside the dialog, because the listener is on `window`) |
| T5 | Backdrop click closes | **PASS** |
| T6 | Meta-click does not open the modal and does not `preventDefault`; plain click does both | **PASS** |
| T7 | **Real upload -> refresh -> auto-close** | **PASS - first ever exercise** |
| T8 | Modal opens from a different tab than the trigger's own panel | **PASS** |
| - | Delete path | **PASS**, and leaves NO storage orphan |
| - | Focus restored to the trigger on close | **FAIL - second defect** |

## T7 in detail - the path that had never run

Uploaded one JPEG through `#photo-upload-modal-input`, clicked **Upload photos**:

- **+2s**: dialog still open, page behind still reads "No photos yet". Upload in flight.
- **+6s**: dialog closed, `document.body.style.overflow` restored, "No photos yet" gone, one
  storage-backed `<img>` present.
- The checklist behind the modal flipped from amber **"Add photos before sharing widely"** to green
  **"Ready to share"**, and "Photos added - recommended" flipped from an open ring to a green check.
- Row proven: `property_photos` id `0ab98db8-...`, `is_cover=true`, `sort_order=0`, storage path
  `b733a191-.../11111111-...-103/0ab98db8-....jpg`.

**The feared race did not happen.** `router.refresh()` completing before `setOpen(false)` means the
operator never sees the dialog vanish with a stale page behind it. The modal's own `initialPhotos`
prop also refreshed - reopening it showed the new photo as **Cover (1/24)**.

**The storage prefix guard (migration `0215`) is holding on a real upload**: the object landed under
the uploading org's own prefix.

## DEFECT 1 (new severity) - there is no focus trap AND no inert background

S663 recorded this as "no focus trap, so tab can escape the dialog". Live, it is worse:

- **One `Shift+Tab` from the Close button leaves the dialog immediately**, landing on
  `A: Review screening ->` in the page behind. Not an edge case at the end of a tab cycle - it is the
  very first backward keystroke.
- Four `Tab` presses forward land on `BUTTON: tab-market` (the "Photos & ad" tab button), also
  outside the dialog, **with the dialog still open**.
- **86 focusable controls remain reachable behind the scrim.** `main` has no `inert` and no
  `aria-hidden`; `body` has no `inert`.

So a keyboard or screen-reader user can tab into and operate the entire application behind a modal
they cannot see focus in, including the tab bar that swaps the content underneath the open dialog.
That is an operability defect, not a polish item.

## DEFECT 2 - focus is not restored on close

Open the dialog from the "3. Photos" next-action card, press Escape: `document.activeElement` is
**`<body>`**. The trigger does not get focus back, so a keyboard user loses their place in a long
detail screen and has to tab from the top of the document. This was not recorded in S663 at all.

## Non-defects checked and cleared

- **`photos_ready` stays `false` after a successful upload.** This is CORRECT, not a bug.
  `photos_ready` is an operator-internal checkbox ("listing photos are shot + ready"), set from a
  form field at `page.tsx:3400` / `distribute-tab.tsx:1055`. Migration `0013_unit_level_fields.sql:53`
  says so explicitly. It is never derived from photo count. Do not "fix" it.
- **Two file inputs coexist without an id collision.** While the modal is open both
  `#photo-upload-modal-input` and `#photo-upload` exist in the DOM; the ids differ, and the modal
  renders `null` when closed, so there is never a duplicate id.
- **Delete leaves no storage orphan.** After Delete, both the `property_photos` row and the
  `storage.objects` entry were gone. Given the S661/S663 orphan history this was worth confirming.
- **Delete does not auto-close the modal.** Correct - `onUploadSuccess` is wired only to the upload
  path, so the operator can delete several photos in a row.

## Trigger inventory (live, at 0 photos)

Only **two** `PhotoUploadLink` triggers actually render on a 0-photo available listing, and both sit
inside tab panels, so neither is visible until you are on the right tab:

- `tab-setup` (Edit listing) - the "3. Photos" next-action card (`next-action-card.tsx:83`)
- `tab-market` (Photos & ad) - the "Add photos ->" checklist link (`page.tsx` BEFORE YOU SHARE block)

The `distribute-tab.tsx:1141` / `:1655` triggers did not render for this property. Once a photo
exists, the "Add photos ->" checklist link disappears and the next-action card retitles itself to
"Photos are already added" but stays a working trigger.

## Verdict

**The shipped feature works.** The carried "never exercised by a real photo upload" caveat is
CLOSED. What remains is an accessibility defect in two parts, filed as
`CODEX-PROMPT-PHOTO-UPLOAD-MODAL-FOCUS-TRAP-S665.md`.
