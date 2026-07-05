# Codex handoff - S418 operator CANCELLATION notification loop

**Review target:** the S418 commit (see DEPLOY-S418 for the exact range/SHA).
**Context:** KI632 - Vacantless-wide gap. There was NO structured "the renter
cancelled" path: a renter cancels by REPLYING to the confirmation email, which
follows `organizations.reply_to_email` and dead-ends at the shared sender when
unset. No `leasing.showing_cancelled` event existed, so on no org did an operator
reliably learn a viewing was called off. This closes that loop.

## What shipped
A one-tap renter cancellation that fires a structured operator notification,
built by cloning the existing outcome-nudge magic-link pattern
(`/showing/[token]` + `record_showing_outcome_from_token`, S392/0098).

1. **Migration `0108_showing_cancel_token.sql`** (ALREADY APPLIED to prod via the
   Supabase connector before this deploy):
   - `showings.cancel_token uuid not null default gen_random_uuid()` + unique
     index. Backfills every existing row, exactly like `outcome_token` (0097).
   - Recreated `book_public_showing` **verbatim from 0103** with the ONLY change
     being `returning id, cancel_token` and a new `cancel_token` field in the
     returned payload. All slot validation / day-off / S400 clustering / lead
     advance / "Viewing booked" note reproduced unchanged.
   - New SECURITY DEFINER `cancel_showing_from_token(p_token uuid)`: keyed on
     `cancel_token`, `for update`; if already `cancelled` returns
     `{ok, already:true}` (idempotent, so the caller does not double-notify);
     else sets `outcome='cancelled'` + logs an inbound note. **Leaves the lead
     stage unchanged** (mirrors the authenticated `updateShowingOutcome`
     cancelled path - the operator decides next step). Returns org/lead/property
     context for the notification. Granted to `anon, authenticated`.

2. **`app/showing/cancel/[token]/page.tsx`** - public confirm page. GET renders
   "Cancel this viewing?" with the viewing details (read by the service-role
   admin client, scoped to the `cancel_token` row). The write is a **POST**
   server action, never a GET side-effect, so email link-scanner prefetch can't
   auto-cancel (KI585). After cancel: confirmation + "Book a new viewing" rebook
   link back to `/r/[propertyId]` (keeps the lead warm). A showing already
   cancelled on GET renders the done state directly.

3. **`app/showing/cancel/[token]/actions.ts`** - the POST action. Calls the RPC
   via the anon server client; on a fresh cancel (`already===false`) fires
   `leasing.showing_cancelled` via `sendOrgNotification`, resolving the operator
   audience through the service-role admin client (mirrors
   `notifyOperatorsOfNewLead`: members + reply_to + public_contact fallback).
   Best-effort - never throws; the cancellation already happened.

4. **`leasing.showing_cancelled`** operator event in `lib/notifications.ts`.
   Default-on (like `leasing.new_lead`; `isEventEnabled(null)===true`), per-org
   overridable in Settings. Amber `defaultAccent` `#d97706` (attention, not a red
   new-lead alarm). Tokens: COMMON + `lead_name`, `showing_time`, `dashboard_url`.

5. **Cancel link in the renter booking-confirmation email** (`lib/email.ts`
   `BookingPayload.cancel_url` + `bookingHtml`; wired in
   `app/r/[propertyId]/actions.ts` from the RPC's new `cancel_token`). Optional /
   back-compat: absent `cancel_url` => the old reply-only wording (reminders etc.
   unaffected).

## Deliberate calls (please sanity-check, not necessarily change)
- **Lead stage unchanged on cancel** (matches `updateShowingOutcome` cancelled).
- **Default-on, not dark** - reactive (only fires when a renter actively taps
  cancel), mirroring `new_lead`; the outcome-nudge shipped dark because it is a
  proactive cron blast needing opt-in. Reactive != proactive.
- **Idempotent, single-notify** - a second cancel returns `already:true` and the
  action skips the notification + the RPC skips a second note.

## Verification done
- tsc clean; `next lint` clean on all changed files; no em/en dashes in new code.
- `test-notifications` 90/0, `test-booking` 40/0, `test-leads-notify` 20/0.
- **RPC-level live-smoke on North Star QA** (`b733a191`) via execute_sql:
  booked a real showing through `book_public_showing` (payload carried
  `cancel_token`); first cancel => `ok/already:false` + full context; showing
  flipped to `cancelled`; lead stayed `booked`; exactly ONE cancel note; second
  cancel => `already:true` (no 2nd note); bad token => `{ok:false,not_found}`.
  QA wiped to baseline (4 showings / 10 leads).
- **Browser + email smoke on the DEPLOYED app (prod `cdc1c9e`), North Star QA -
  PASSED end to end [2026-07-05]:** booked a viewing through the deployed
  `app.vacantless.com/r/<833-Pillette-QA>` page (renter noam@royallepage.ca);
  the confirmation email carried the brand-styled "Cancel this viewing" link;
  the deployed `/showing/cancel/[token]` page rendered the confirm state; tapping
  "Yes, cancel my viewing" flipped it to "Your viewing is cancelled" + the
  "Book a new viewing" rebook button; the operator `leasing.showing_cancelled`
  email ("Viewing cancelled - S418 Cancel Smoke at 833 Pillette...") landed in
  the inbox (temporary recipient override to a readable box, removed after); DB
  confirmed showing `cancelled` / lead stage unchanged / one note. QA wiped to
  baseline (4 showings / 10 leads, override deleted).

## Blast radius on deploy (Agile is live)
Ships live to ALL orgs. A real renter cancellation on Agile will now email the
resolved operator list (members + `reply_to_email` = rentals@agileonline.ca +
public_contact). That is the intended behavior (Aaliyah/Peter should learn of
cancellations). Per-org overridable in Settings -> Notifications if needed.
