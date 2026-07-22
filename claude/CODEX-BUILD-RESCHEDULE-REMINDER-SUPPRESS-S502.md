# CODEX BUILD — Suppress reminders while a reschedule is pending — S502

**Part C (ship-first) of DESIGN-SHOWING-CLUSTERING-AND-RESCHEDULE-COHERENCE-2026-07-16.md.** Codex verdict on Part C = **ACCEPT**. Bug fix, **no migration**, no behavior change to the reminders themselves — just an eligibility filter. Parts A and B are later slices, out of scope here.

## Why
A showing that is mid-reschedule still receives its normal reminders for the slot we're trying to move the renter off. Verified live: Brien's Fri Jul 17 6pm (now uncovered) is due a 24h renter reminder ~tonight, and its assigned-agent confirmation nudge would also fire — both telling people to confirm/attend a slot a reschedule proposal has already asked to change. Reminders should pause while a reschedule is unresolved, then resume for the new time once the renter picks.

## Definition — "mid-reschedule"
A showing has an **unresponded pending reschedule** iff a `showing_reschedule_proposals` row exists for it with `status = 'pending'` AND `responded_at IS NULL`. (`proposeShowingTimes` expires prior pendings and inserts a new one, so at most one qualifies per showing.)

## Changes (two routes, filter only)

### 1. Renter reminders — `app/api/cron/reminders/route.ts`
The candidate select (`:74`, `outcome='scheduled'` + time window + not-yet-sent) must **exclude** showings that are mid-reschedule. Since supabase-js has no `NOT EXISTS` subquery, the clean approach: in the same run, fetch the set of `showing_id`s with an unresponded pending proposal (scoped to the candidate org/showings), then drop those showings from the reminder candidates **before** any email/SMS send and **before** any `reminder_*_sent_at` stamp is written. A suppressed showing must keep its reminder stamps null so the reminder fires correctly for the new time after the renter accepts.

### 2. Operator confirmation nudge — `app/api/cron/showing-confirmation-nudge/route.ts`
Same exclusion for the assigned-agent nudge select (`:20`). **Critical:** skip the mid-reschedule showing **before** its one-shot "nudge sent" stamp is consumed — do not mark it, so the nudge still fires once the reschedule resolves to a new time. (Audience here is the operator/assigned agent per `lib/notifications.ts:389`, not the renter — filtering is still correct: don't tell the agent to confirm the old slot.)

## Invariants (preserve byte-for-byte)
- Reminder copy, timing bands, the S498b confirm/reschedule CTA, and the SMS path are unchanged — this only changes **which** showings are eligible.
- Once the renter accepts a proposal (showing moves, proposal `responded_at` set) or the proposal expires, the showing is no longer "mid-reschedule" and both reminders resume normally for the new time.
- No change to `proposeShowingTimes`, `accept_reschedule_proposal`, or `sendRescheduleProposal`.
- No migration, no schema change.

## Verification
- `tsc --noEmit` + lint + `next build` clean (Noam runs the gate).
- Existing `test-reminders` (13/0) stays green; add coverage: a showing with an unresponded pending proposal is **skipped** by both routes and its stamps remain null; after the proposal is responded, it's eligible again.
- Cowork verifies the diff via `device_bash git` in MAIN context: confirm only the two route selects/filters changed, no reminder-copy or stamp-logic changes beyond the skip, no migration file.
- Live read-only QA on Agile: Brien's Fri 6pm (pending proposal) is not in either route's candidate set on a `?dry` run.

## Out of scope
Part A (clustering opens covered days — JS + RPC parity migration) and Part B (reschedule re-reminder cron + `reminded_at`). Separate tickets after this ships.
