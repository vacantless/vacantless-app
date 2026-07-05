# S419 - Codex P2 fix: gate the public cancel RPC to non-terminal outcomes

**Context:** Codex's review of S418 `cdc1c9e` flagged one P2 on
`cancel_showing_from_token`. This is the fix.

## The bug (Codex, verbatim intent)

`cancel_showing_from_token` only treated `outcome='cancelled'` as the idempotent
case. Any OTHER current outcome fell into the else branch and was overwritten to
`cancelled`. So a renter tapping a stale "Cancel this viewing" email link AFTER an
operator had recorded `attended` or `no_show` would (1) corrupt the showing
history, (2) log a spurious renter-cancel note, and (3) fire a fresh
`leasing.showing_cancelled` operator notification. The confirm page also still
rendered "Cancel this viewing?" for those resolved rows.

## The fix

Only a still-open showing (`outcome` null or `'scheduled'`) is cancellable.

- **Migration `0109_showing_cancel_terminal_guard.sql`** recreates
  `cancel_showing_from_token` (only that function; `book_public_showing` and the
  `cancel_token` column are untouched). New `state` field in the return:
  - `outcome = 'cancelled'` -> `state='already_cancelled'`, `already=true`
    (idempotent no-op, unchanged behavior).
  - `outcome in ('attended','no_show')` -> `state='closed'`, `ok=false`, row
    **NOT** touched, no note, no notify.
  - else (open) -> `state='cancelled_now'`, the guarded `UPDATE ... where id=?
    and (outcome is null or outcome='scheduled')` flips it, logs the note. This is
    the ONLY case that mutates the row or is allowed to notify.
  - The row is `SELECT ... FOR UPDATE` locked, so the branch and the guarded
    UPDATE cannot race.
- **`actions.ts`** branches on `state`: only `cancelled_now` calls
  `notifyOperatorsOfCancellation`; `already_cancelled` -> cancelled page (no
  notify); `closed` -> `?status=closed` (no notify); `not_found` -> invalid. A
  `default` fall-through preserves the old `ok`/`already` contract for a
  pre-0109 mixed deploy.
- **`page.tsx`** derives `isClosed` for `outcome in ('attended','no_show')` (or
  `?status=closed`) and renders a read-only "This viewing can no longer be
  cancelled" state (address + time + rebook + "reply to your confirmation email"),
  so a stale GET never shows the cancel form.

## Backward-compat / deploy-order safety

The return shape is a SUPERSET of 0108 (`ok` + `already` kept with old meaning;
`state` added). `closed` returns `ok=false`, so even the OLD deployed action
declines it (redirect to a generic error, no notify, no overwrite) - the migration
can be applied BEFORE the code deploy with zero corruption risk. Applied to prod
this session (via the Supabase connector, ref `nvhvdyxpyogvadpjlvij`).

## Verification (this session)

- tsc clean; `eslint --no-cache` clean on `actions.ts` + `page.tsx`; no em dashes.
- test-notifications 90/0, test-booking 40/0, test-leads-notify 20/0.
- **Live RPC smoke on North Star QA org `b733a191`** (then wiped to 0/0):
  created scheduled + attended + no_show showings, called the RPC on each.
  - scheduled -> `cancelled_now`, second call -> `already_cancelled`.
  - attended -> `closed` (`ok=false`); no_show -> `closed` (`ok=false`).
  - Post-check: attended row STILL `attended`, no_show STILL `no_show` (NOT
    overwritten), scheduled row now `cancelled`; exactly ONE cancel note logged
    (for the scheduled cancellation), NONE for the terminal rows.

## Deliberate scope note (for Codex)

Fix gates on outcome STATE, not on scheduled time. Codex's review suggested
"probably future showings too if the promise is 'free the slot'". I did NOT add a
time gate: the corruption vector Codex identified is the terminal-outcome
overwrite (now closed), and a renter cancelling a still-`scheduled` past showing
with no recorded outcome is a reasonable "I'm not coming" signal to the operator,
not a data-integrity problem. Open to adding a `scheduled_at > now()` gate if you
consider a past-but-open cancellation undesirable.

**Review target:** the S419 commit on `main` (range from `cde00e2`), plus
migration `0109` (already applied to prod).
