# S409 BUILD 2 - tap-first renter booking form (Codex review request)

Date: 2026-07-04
Repo: `vacantless-app` on `main`
Review target: the S409 BUILD-2 commit (this note is committed in it).
Scope: reshape the public `/r/[propertyId]` inquiry+booking form into a tap-first
flow (Noam's spec `BOOKING-FORM-UX-REFINEMENT-SPEC-2026-07-04.md`). Presentation
+ a new client component. No migration, no env, and **no change to the submit
action or the qualify-out RPC**.

## Why

S408 diagnosed that the public form read like a rental application and renters
bounced. BUILD 2 makes it feel like a fast booking: choose a time first, then a
few contact fields, then optional tap-friendly pills, then confirm.

## Files touched

- `app/r/[propertyId]/inquiry-form.tsx` (**new, client component**) - the whole
  interactive form.
- `app/r/[propertyId]/page.tsx` - server component still computes everything and
  now renders `<InquiryForm .../>` in place of the old inline `<form>`; added a
  server-side `moveInPills` (next two month labels, computed server-side to avoid
  a hydration mismatch); removed the now-unused `hasRequiredScreening` const (its
  S408/S409 accordion is gone - see below).

## The data contract is UNCHANGED (this is the key review point)

The submit action `submitLead` and the qualify-out RPC are **not touched**. Every
field NAME the action reads is preserved, so the same data lands:

- `property_id`, `listing_post_id` - hidden inputs (attribution unchanged).
- `name` (required), `email` (required), `phone` (optional) - plain inputs.
- `slot` - native `<input type="radio" name="slot">` (controlled by React state
  but still a real radio, so it submits and works without JS).
- `move_in` - hidden input fed by the move-in pills / "Pick a date". The RPC's
  `p_move_in` is a **DATE** (and feeds the move-in-window qualify-out check), so
  every pill VALUE is an ISO date computed server-side and the label is display
  only: "As soon as possible" = today, the two month pills = the 1st of the next
  two months, "Pick a date" = the date input, and "Flexible" submits an empty
  value (-> `p_move_in` null). The client tracks the selected pill by label
  (`moveInChoice`) separately from the submitted date so "Flexible" (empty value)
  is visibly selectable without colliding with "unselected". (Live QA caught the
  first pass, which submitted the labels as `move_in` and errored the RPC date
  cast.)
- `screen_occupants` - hidden input fed by numeric pills (1/2/3/4/5+). The "5+"
  pill submits "5" because `parseCount` rejects "5+". (Numeric chosen over the
  spec's categorical labels because the column is a display-only integer and no
  schema change is allowed this build, so numeric loses no data. Noam delegated
  this call.)
- `screen_pets_detail` + `screen_has_pets` - fed by the pets pills. "No pets"
  submits an EMPTY `screen_pets_detail` and no `screen_has_pets` (a non-empty
  detail is exactly what the action treats as "has a pet"); any real-pet pill
  submits the label + `screen_has_pets=1`.
- `screen_income` - unchanged text input, rendered only when
  `screening_enabled`. This is what gates `screeningShown = formData.has(
  "screen_income")` in the action, so screeningShown === screening_enabled,
  exactly as before.
- `cq_<id>` custom questions - unchanged inputs/selects with the same
  `required={q.required}`, and the same `units`-with-0-choices renders-nothing
  rule.
- `notes` - textarea, now revealed by a "+ Add a note or question" link.

## Deliberate decisions worth a close look

1. **Supersedes the S408/S409 screening accordion.** The spec (§2) says remove the
   "optional details" accordion. So the income + custom-question group is now shown
   directly in a light, clearly-optional "Help us prepare" section instead of a
   collapsed `<details>`. Because it's always visible, a required custom question
   is always visible too - which resolves the S409 hidden-required-field concern
   structurally (no accordion to hide it in), so `hasRequiredScreening` is gone.
2. **JS dependency, with a real-form baseline.** The pills, the note reveal, the
   "More times" toggle, and the confirm-label swap ("Confirm viewing" vs "Send my
   details") need JS. But it stays a real `<form action={submitLead}>` with native
   radio slot inputs and native required name/email, so a no-JS renter can still
   pick a time and submit (they just don't get the pill niceties). Accepted
   deliberately per spec note.
3. **Occupants pills are numeric** (see contract above).
4. **`screen_occupants` / pets now collected even when screening is off.** The
   pills sit outside the screening gate (spec wants them for everyone). This only
   adds optional info to the lead; it does not run qualify-out (that still only
   fires when `screeningShown`).

## Preserved copy / rules

- The ESL "in-person viewing (not a phone call)" line is kept.
- The SMS/STOP consent line beside phone is kept.
- The clustering note ("these times group your visit...") is kept.
- The slot-taken rebook form and the submitted/booked confirmation branch in
  page.tsx are untouched.

## Verification (here)

- `npx tsc --noEmit` - clean (exit 0).
- `npx eslint --no-cache` on both files - green (exit 0).
- Suites: `test-booking` 40/0, `test-screening` 120/0, `test-screening-questions`
  116/0, `test-leads-notify` 20/0, `test-lead-detail` 44/0.
- Live North Star QA test: [to be run post-deploy - open a Live listing's /r page,
  tap a time, fill name+email, tap a couple pills, add a note, confirm; verify the
  lead + booking land with move_in/occupants/pets/notes populated].
