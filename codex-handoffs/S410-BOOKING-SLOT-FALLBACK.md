# S410 - booking slot-fallback (Codex S409-BUILD2 P2 fix)

Date: 2026-07-04
Repo: `vacantless-app` on `main`
Review target: the S410 commit (this note is committed in it).
Responds to: Codex's S409 BUILD 2 follow-up review, which accepted everything from
`828e0b3` and left **one P2**.

## The P2 (Codex's words, confirmed reproduced)

On `/r/[propertyId]`, if a renter taps **More times**, selects a slot from day 4+,
then taps **Show fewer**, `visibleDays` collapses back to `days.slice(0, 3)` so the
selected slot's radio unmounts. `selectedSlot` state persists, so the UI still shows
"Selected viewing" / "Confirm viewing" - but the submitted FormData has no `slot`,
and `submitLead` saves an **inquiry** instead of the viewing the renter thinks they
confirmed. Silent downgrade.

## Fix (Codex's option 1 + 3 combined: keep the choice, mount a fallback)

Presentation only. `submitLead`, the qualify-out RPC, and every field NAME are
untouched. No migration, no env.

- `lib/booking.ts` - extracted the visibility rule into two pure, exported helpers
  so there is a single source of truth and it is unit-testable:
  - `COLLAPSED_DAY_COUNT = 3`
  - `visibleBookingDays(days, showAll)` -> the rendered subset.
  - `selectedSlotIsRendered(days, showAll, iso)` -> is the selected slot's radio
    currently mounted? (empty/unknown iso -> false).
- `app/r/[propertyId]/inquiry-form.tsx`:
  - `visibleDays` now comes from `visibleBookingDays(...)`.
  - `selectedSlotVisible` now comes from `selectedSlotIsRendered(...)`.
  - Added, alongside the other hidden inputs:
    `{hasSlots && selectedSlot && !selectedSlotVisible && (<input type="hidden" name="slot" value={selectedSlot} />)}`.
    The unmounted radio submits nothing, so there is exactly one `slot` value in
    the FormData - no collision. The renter **keeps** their choice across a
    collapse (chosen over clearing `selectedSlot`, which would silently lose it).

## Why a hidden fallback over "clear on collapse"

Clearing `selectedSlot` when Show-fewer would hide it also fixes the mismatch, but
it throws away a choice the renter already made and leaves them on "Send my
details" with no explanation. Keeping the selection matches what the UI already
says ("Selected viewing: ...") and is the smaller surprise.

## Verification (here)

- `scripts/test-slot-fallback.ts` - **new**, 12/0. Pins the invariant: day 4+ while
  collapsed => not rendered => fallback required; the first 3 days and the expanded
  view => rendered; empty/unknown iso => not rendered; <3-day sets never hide.
- `npx tsc --noEmit` - clean (exit 0).
- `npx eslint --no-cache` on `inquiry-form.tsx`, `lib/booking.ts`,
  `scripts/test-slot-fallback.ts` - green (exit 0).
- Regression `scripts/test-booking.ts` - 40/0.
- Live-smoked on prod (a9b73fb), North Star QA 506 Manning `/r` (renders 4 days):
  More times -> select Sat Jul 18 10:00 AM (day 4) -> Show fewer (its radio
  unmounts) -> Confirm -> "Your viewing is booked!". DB: lead booked with a showing
  at 2026-07-18 14:00:00Z (the collapsed-day slot survived via the hidden fallback;
  no downgrade to inquiry). Test showing cancelled afterward.

## Unrelated but confirmed healthy

A real FB Marketplace lead (Pillette Unit 20, Agile prod) came through the
tap-first form today and booked correctly: `move_in=2026-08-01` (ISO), occupants
`2`, no pets, income captured, `qualified_out=false`, showing scheduled. Happy path
is validated in production; this P2 only affects the collapse edge case.
