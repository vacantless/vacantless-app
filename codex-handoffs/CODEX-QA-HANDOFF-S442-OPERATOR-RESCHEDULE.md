# Codex QA handoff — S442 operator reschedule

**Range:** `e77089f..HEAD` (the S442 commit). **No migration.**

## What shipped
Operators can now reschedule an upcoming, still-open viewing to a new time from the
Viewings page. Gated on `manage_leads` (same as assign/confirm). Moving the time
re-arms the viewing's reminders + nudges, resets any prior confirmation, and
re-notifies the renter and the assigned covering agent.

## Files
- **`lib/booking.ts`** — two new pure helpers: `parseLocalInputToUtc(value, tz)`
  (datetime-local wall string -> UTC instant via the existing DST-correct
  `zonedWallTimeToUtc`; rejects malformed / rolled-over / out-of-range values) and
  `utcToLocalInputValue(iso, tz)` (UTC -> "YYYY-MM-DDTHH:mm" for the input default).
  Exact inverses modulo the spring-forward gap. Tests in `scripts/test-booking.ts`
  (52/0; 12 new cases incl. EDT/EST, round-trip, Feb-30 reject, midnight normalize).
- **`lib/notifications.ts`** — new operator event `leasing.showing_rescheduled`
  (agent audience, amber accent, ships active). Mirrors `leasing.showing_assigned`;
  tokens add `old_showing_time` + `rescheduled_by`.
- **`lib/email.ts`** — `sendShowingRescheduled` (renter-facing "your time changed"
  email; new time + struck-through old time + surviving cancel link). Mirrors
  `sendBookingConfirmation` exactly; best-effort, never throws.
- **`app/dashboard/showings/actions.ts`** — `rescheduleShowing` server action.
- **`app/dashboard/showings/reschedule-control.tsx`** — no-JS `<details>` disclosure
  with a `datetime-local` input (pre-filled to the current time, `min`=now).
- **`app/dashboard/showings/page.tsx`** — renders the control on upcoming scheduled
  rows for a `manage_leads` viewer; computes the per-row default + `min` server-side.

## Design / guard notes worth a review eye
- **Timezone:** the input is a bare wall-clock string the operator means in the org
  booking timezone; the action converts with `parseLocalInputToUtc` (never a
  hand-rolled offset), rejects a malformed value and any time `<= now`.
- **State guard:** only a viewing with `outcome` NULL or `'scheduled'` can move. The
  UPDATE re-checks org scope + `outcome.is.null,outcome.eq.scheduled` (same PostgREST
  `.or()` pattern proven in `setShowingConfirmed`), so a row cancelled/closed
  concurrently matches nothing and nothing is logged/sent. Live-verified on North
  Star that a cancelled row is immune.
- **Reset set:** `scheduled_at` moves; `reminder_24h/2h_sent_at`,
  `reminder_24h/2h_sms_sent_at`, `feedback_request_sent_at`, `outcome_nudge_sent_at`,
  `confirmation_nudge_sent_at` -> null (re-fire for the new time); `confirmed_at`/
  `confirmed_by` -> null (the renter agreed to the OLD time; new slot is unconfirmed,
  mirrors the assignShowing reset). `assigned_agent_id` + `cancel_token`/`outcome_token`/
  `agent_token` are preserved (same agent covers the new time; cancel link still works).
- **Re-notify:** renter gets `sendShowingRescheduled` (only when they have an email);
  the assigned agent (if any, non-archived) gets `leasing.showing_rescheduled` with
  the agent as the always-included `audienceEmail`, like `leasing.showing_assigned`.
  Both best-effort. A timeline note "Viewing rescheduled from X to Y" is the audit trail.

## Known deferred (not bugs)
- No immediate reschedule **SMS** to the renter (email only). SMS *reminders* still
  re-fire for the new time because the sms stamps are reset — so this is a missing
  instant notice, not a missing reminder.
- DST spring-forward "gap" wall times (the one nonexistent hour/year) resolve via the
  zone's reported offset, consistent with the accepted leasing-snapshot simplification.

## Gate
tsc clean · eslint clean · test-booking 52/0 · test-notifications 91/0 ·
test-showing-agents 83/0 · test-leads-notify 20/0. Live schema QA on North Star
(b733a191): seed -> guarded UPDATE -> assertions held -> torn down clean (0 orphans).
