# DESIGN — Showing clustering + reschedule coherence — 2026-07-16

**Status:** CODEX-REVIEWED (2026-07-16, read-only at ba899ea). Verdict: Part C **ACCEPT**, Parts A & B **ACCEPT-WITH-CHANGES**. Corrections folded below. Build order confirmed **C → A → B**. Ticket for the first slice: `CODEX-BUILD-RESCHEDULE-REMINDER-SUPPRESS-S502.md`.

**Principle (Noam):** *When an operator already has showings booked on a day, prefer to cluster more viewings onto that same on-site block — don't send renters to fresh far-off days. Minimize trips per day and per week.*

Three related gaps, each its own slice. All current-state claims verified by Codex against the code.

---

## Part A — Clustering should open a covered day (availability engine) — ACCEPT-WITH-CHANGES

**Current behavior (verified):** `generateSlots` (`lib/booking.ts:193`) builds each day's slots from `rules`/`overrides` (days-off first, then lead/booked filtering), then — when `clustering_enabled` — `clusterDays` (`lib/booking.ts:342`) **only filters** already-created day slots to those near an anchor. It never **creates** availability. So a day with booked showings but no `rule`/`override` (closed under opt-in) generates zero base slots → nothing to cluster. Confirmed live: today (Jul 16) has 4 booked viewings at 833 Pillette (agent on-site 5:00–7:30) but no override, so the picker offered nothing today and jumped to Jul 20.

**Proposal:** when `clustering_enabled` and a building+day has anchor showing(s) for the target building, **synthesize a bookable window from the anchors** even with no rule/override; `clusterDays` then tightens as usual.

### ⚠️ Codex P1 — Part A is NOT migration-free (RPC parity required)
The JS `generateSlots` only builds the **display**. The renter accept RPC `accept_reschedule_proposal` (mig 0150, `…/0150_…self_exclude.sql:130`) and the public `book_public_showing` RPC (mig 0148, `…/0148_availability_overrides.sql:216`) **re-validate against rules/overrides *before* clustering** and would **reject a synthesized slot**. The renter accept action calls the RPC directly (`app/showing/reschedule/[token]/actions.ts:168`). So Part A needs **RPC parity** — a **function-replacement migration** mirroring the anchored-day synthesis in SQL (no new table/column, but a real migration).

### File-level plan (Codex)
- **JS:** add `SlotGenerationOptions.relaxLeadForAnchoredDays?: boolean` (`lib/booking.ts:64`). Compute target-building anchors **before** the early `return []` (that guard currently kills a fully opt-in-closed org). Build synthetic slots for eligible anchored days within horizon over `[min(anchor)−buffer, max(anchor)+buffer]`, stepping `slot_minutes`, with the same **start-time-inclusive** semantics `clusterDays` uses. Keep `days_off` absolute (if `dayKey ∈ daysOff`, never synthesize).
- **Capacity (corrected):** use anchors **after** `excludeShowingId` (the S499 self-exclude). If `anchors.length >= showing_block_capacity`, **skip the day**. Do **NOT** slice the visible slot choices to `cap − anchors` — capacity semantics are *"remaining successful bookings in this building-day"*, enforced at **validation/acceptance**, not "number of radio buttons shown."
- **Lead time (operator vs renter):** thread `relaxLeadForAnchoredDays: true` **only** through the operator paths — `app/dashboard/showings/page.tsx:175` and `proposeShowingTimes` (`app/dashboard/showings/actions.ts:146`). Public `/r` stays **default** lead time (`app/r/[propertyId]/page.tsx:112`, `…/actions.ts:75`).
- **SQL parity:** mirror the anchored-day synthesis in `accept_reschedule_proposal` (relaxed lead, matching the operator flow) and in `book_public_showing` (synthetic anchored-day windows **at normal lead time — never relaxed**).

**Guardrails:** `days_off` always wins; capacity hard-capped via the S499 self-exclude path; window bound to anchor ± `clustering_buffer_minutes`; `buildingKey()` remains the single source of truth for "same building."

**Verification:** unit tests on `generateSlots` (anchored closed day offers slots; day-off anchored day stays closed; capacity via self-exclude; renter keeps lead, operator relaxes; overridden anchored day unchanged) **plus** SQL parity tests that the two RPCs accept a synthesized anchored-day slot under the same rules.

---

## Part B — Reschedule-proposal re-reminder — ACCEPT-WITH-CHANGES

**Current behavior (verified):** `proposeShowingTimes` (`app/dashboard/showings/actions.ts:154`) expires prior pending proposals, inserts a new pending `showing_reschedule_proposals` row, and emails via `sendRescheduleProposal`. **Nothing follows up.** No `reminded_at` column; no reschedule-nudge cron. Confirmed with Brien (proposed 09:05, re-sent 12:18, still no auto follow-up).

**Proposal:** a per-org cron that re-nudges the **latest pending** proposal once, `N` hours after creation, if unresponded and the original showing is still upcoming. Migration adds `showing_reschedule_proposals.reminded_at timestamptz`; new `app/api/cron/reschedule-nudge/route.ts` + curl in `reminders.yml`, modeled on `leasing-snapshot`/`viewing-reminder` (CRON_SECRET, per-org, `cache:no-store`, stamp once).

### Codex P2 — notification semantics
`sendRescheduleProposal` is a **direct renter email**, **not** a configurable `NOTIFICATION_EVENTS` send. So drop "respect the notification event on/off." Decide before build: either (a) define a new `NOTIFICATION_EVENTS` entry for the re-nudge deliberately, or (b) treat it as a direct renter email gated by a simple per-org on/off setting.

**Guardrails:** newest pending proposal only; stop if responded / showing closed / original time passed; cap at one re-nudge (tunable).

---

## Part C — Suppress the reminder while a reschedule is pending — ACCEPT — SHIP FIRST

**Current behavior (verified):** `app/api/cron/reminders/route.ts:74` selects upcoming `scheduled` showings and does **not** exclude pending-proposal showings; it sends the renter email/SMS reminder with the S498b confirm/reschedule CTA. `showing-confirmation-nudge` (`app/api/cron/showing-confirmation-nudge/route.ts:20`) has the same gap. Live: Brien's Fri Jul 17 6pm (uncovered) is due a 24h renter reminder ~tonight despite the reschedule.

**Proposal:** exclude showings with an **unresponded pending** `showing_reschedule_proposals` row from **both** reminder selects.

### Codex resolution — confirmation-nudge audience
`showing-confirmation-nudge` is **operator/assigned-agent** facing (`lib/notifications.ts:389`), not renter. **Still filter it** in Part C: while a reschedule is pending, the agent shouldn't be nudged to confirm the old slot, **and the one-shot stamp must not be consumed** (so the nudge still fires correctly once the new time lands).

**Guardrails:** suppress only while pending; once the renter accepts (showing moves) or the proposal expires, normal reminders resume for the **new** time. Minimal filter, **no migration**.

---

## Sequencing (Codex-confirmed)
1. **Part C** — bug fix, no migration, smallest. **Ship first** (prevents the Brien-style conflict). Filters the renter reminder route **and** the operator confirmation-nudge (without consuming its stamp).
2. **Part A** — the feature. Treat as **JS + RPC parity** (function-replacement migration for `accept_reschedule_proposal` and `book_public_showing`), NOT migration-free. Operator relaxes lead on anchored days; renter/public keep normal lead.
3. **Part B** — new cron + `reminded_at` migration + a notification-semantics decision. Last.

## Resolved by the Codex review
- **Renter self-booking:** no lead-time relaxation. It may get synthetic covered-day windows, but only under **normal** `booking_lead_hours`. Only the operator suggested-times flow relaxes lead for anchored days.
- **Window bounds:** anchor ± `clustering_buffer_minutes` — not a new "on-site span" concept. A wider real on-site span than booked anchors imply would be a separate data-model change.
- **Capacity:** use the S499 self-exclude exactly — exclude the moving showing before counting anchors, enforce the cap at validation/acceptance (not by trimming shown options).
- **Confirmation-nudge audience:** operator/assigned-agent; still filtered in Part C; don't consume its one-shot stamp.

## Pairs with opt-in
Opt-in closes days you're **not** covering; Part A reopens days you **are** — renters can only book when and where an agent will actually be.
