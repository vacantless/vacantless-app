# CODEX BUILD — Clustering opens a covered day (availability engine + RPC parity) — S503

**Part A of `DESIGN-SHOWING-CLUSTERING-AND-RESCHEDULE-COHERENCE-2026-07-16.md`.** Codex verdict on Part A = **ACCEPT-WITH-CHANGES** (the P1 below is already folded in). Part C shipped (S502, `86444ab`). Part B (reschedule re-reminder + `reminded_at`) is a later ticket — out of scope here.

Grounded against `HEAD = 86444ab352e6c4df4154a3871c2025ce8083d95c` (`main`). All line numbers are at that SHA.

---

## Why
Under opt-in availability, a day with **booked showings but no rule/override is closed**, so `generateSlots` produces zero base slots and `clusterDays` — which only *filters* existing slots — has nothing to cluster. Proven live: Jul 16 had 4 booked viewings at 833 Pillette (agent on-site 5:00–7:30 PM) but no override, so the reschedule/booking picker offered **nothing that day** and jumped to Jul 20. Two forces hid the on-site day: (1) the day was closed (no synthesized window), and (2) `booking_lead_hours=12` walled off the same-day slots even if it had been open.

Part A makes an **anchored** building+day (the agent is already going there) offer slots clustered around the on-site window, and lets the **operator** flow book at shorter notice on such days. Opt-in closes the days you're *not* covering; Part A reopens the ones you *are*.

## ⚠️ Codex P1 (already decided): this is NOT migration-free
`generateSlots` builds only the **display**. Both write RPCs re-validate server-side **before** their clustering block and would reject a synthesized slot:
- `accept_reschedule_proposal` — mig `0150_reschedule_move_capacity_self_exclude.sql` (renter accept calls it directly at `app/showing/reschedule/[token]/actions.ts:168`).
- `book_public_showing` — mig `0148_availability_overrides.sql:216` (public `/r` calls it at `app/r/[propertyId]/actions.ts:79`).

So Part A ships as **JS + one function-replacement migration** (`0152`) that recreates both functions with the same synthesis logic. **No new table/column, no schema change** — `create or replace function` only.

---

## THE PARITY CONTRACT (single source of truth — JS and both RPCs must agree byte-for-byte)

Define, for the target building on a calendar date **D** (in the org booking timezone):

- **`anchors(D)`** = future showings `s` where `buildingKey(s.address) == targetKey`, `s.outcome = 'scheduled'`, `s.scheduled_at` is in the future, and `s.scheduled_at`'s date-in-tz `== D`, **excluding the moving showing** (`excludeShowingId` in JS / `s.id <> v_showing_id` in `accept_reschedule_proposal`; the public booking excludes nothing — it's a new showing). This is exactly the existing anchor set — the S499 self-exclude — just computed **earlier**.
- **`D` is _anchored_** iff `clustering_enabled` AND `1 <= anchors(D).length < cap` (`cap = showing_block_capacity`, default 6). `anchors >= cap` ⇒ day is full ⇒ **no slots** (existing behavior, keep).
- **`D` is _synthesized_** iff `D` is anchored AND `D` has **no** `availability_days_off` row AND **no** `availability_overrides` row AND **no** weekly `availability_rules` row for its weekday — i.e. `D` would otherwise generate zero base slots. **A day that already has a rule/override is NOT synthesized** — it keeps today's behavior (base slots built from the rule, then `clusterDays` tightens them). `days_off` is always absolute: never synthesize or offer on a day-off.

**The synthesized slot grid on a synthesized day D:**
- `lo = min(anchors(D)) − buffer`, `hi = max(anchors(D)) + buffer` (`buffer = clustering_buffer_minutes`, default 60 — same bound `clusterDays` already uses).
- Candidate start instants = `{ lo + k·slotMin : k = 0,1,2,… } ∩ [lo, hi]`, **start-inclusive at both ends** (`slotMin = booking_slot_minutes`, default 30). **Step origin is `lo`** — this is the contract; JS and SQL must both step from `lo`.
- Drop any instant that is already `booked` / `taken` (existing "taken" guard).
- Seconds must be zero (existing guard; guaranteed by construction).
- **Lead floor (the operator-vs-renter split):**
  - **Operator paths** (`relaxLeadForAnchoredDays = true`): keep instants with `t > now()` — the `booking_lead_hours` floor is **waived on anchored days** (synthesized *and* covered). Still must be strictly future.
  - **Renter / public paths** (flag absent/false = default): keep instants with `t >= now() + booking_lead_hours`. **Never relaxed.**
- Within horizon (existing `0..horizon` day loop / horizon bound).
- Synthesized slots carry `clustered: true`.

Covered (rule/override) anchored days are unchanged except that the **operator** lead floor is relaxed on them too (see below); their slot grid still comes from the rule/override and is tightened by `clusterDays`.

---

## JS changes — `lib/booking.ts`

1. **Option flag.** Add `relaxLeadForAnchoredDays?: boolean;` to `SlotGenerationOptions` (`:64–66`). Default false/absent = today's behavior exactly.

2. **Compute anchors early.** When `av.clustering_enabled` and `targetKey = buildingKey(av.target_address)` is non-empty, build `anchorsByDay: Map<dayKey, number[]>` from `av.cluster_candidates`, applying the **same** filters used today at `:274–278` (self-exclude `options.excludeShowingId`, `buildingKey === targetKey`, valid `scheduled_at`). Do this **before** the `if (byWeekday.size === 0 && byDate.size === 0) return [];` guard at `:223`.

3. **Don't early-return when there are anchors to synthesize.** Change `:223` so it only returns `[]` when there are no rules, no overrides, **and** `anchorsByDay` is empty. (A fully opt-in-closed org like Agile must still get synthesized anchored days.)

4. **Per-day lead floor + synthesis in the day loop (`:229–267`).** For each day `D` (after the `daysOff.has(dayKey)` continue):
   - `anchors = anchorsByDay.get(dayKey)`; `isAnchored = !!anchors && anchors.length >= 1 && anchors.length < cap` (`cap = av.showing_block_capacity ?? 6`).
   - `leadFloor = (options.relaxLeadForAnchoredDays && isAnchored) ? now.getTime() : earliest` — apply this in place of the fixed `earliest` compare at `:250` for **both** the rule path and the synth path. (`> now` for relaxed; `>= earliest` stays for renter.)
   - **Rule/override path (unchanged shape):** build base slots as today, but gate on `leadFloor` instead of `earliest`.
   - **Synth path (new):** when the day has **no** `rules` (the current `if (!rules || rules.length === 0) continue;` at `:238`) **and** `isAnchored` **and** not a day-off: instead of `continue`, generate the synthesized grid — `lo = min(anchors) − buffer`, `hi = max(anchors) + buffer`, step `slotMin` from `lo`, keep `t` where `t >= lo && t <= hi && t > (leadFloor - 1)` (i.e. `>= leadFloor`), skip `booked.has(t)`, push `{ iso, label, clustered: true }`.

5. **Keep the final clustering pass (`:271–288`) as the uniform tightener.** It already: passes through non-anchor days, drops days at/over cap, filters covered-day slots to `[lo, hi]` and marks `clustered`. Synthesized slots are already inside `[lo, hi]`, so they survive unchanged. Net effect: `clusterDays` remains the single window/cap authority for the display; the loop only *adds* the synthesized candidates and the relaxed lead floor. Do **not** duplicate window/cap logic in the loop.

**Thread the flag through operator paths ONLY:**
- `app/dashboard/showings/actions.ts` `proposeShowingTimes` — the `generateSlots(..., { excludeShowingId: showing.id })` call (near `:142–147`): add `relaxLeadForAnchoredDays: true`.
- `app/dashboard/showings/page.tsx:175–178` — the operator picker `generateSlots(..., { excludeShowingId: showing.id })`: add `relaxLeadForAnchoredDays: true`.
- **Leave public untouched:** `app/r/[propertyId]/page.tsx:112` (`generateSlots(avForSlots)`) stays default lead. Confirm no other `generateSlots` caller exists.

---

## SQL changes — new migration `0152` (`create or replace function` for BOTH RPCs)

Recreate `accept_reschedule_proposal(uuid, timestamptz)` (from `0150`) and `book_public_showing(uuid, uuid, timestamptz)` (from `0148`) with the synthesis logic. Preserve every existing local, return payload, grant, and exception handler **verbatim** except the changes below. **Copy each function whole from its current migration and edit in place** — do not hand-rewrite the payload/SELECTs.

In **each** function:

1. **Hoist the anchor computation before the rule/override check.** The anchor `count/min/max` SELECT currently sits inside the clustering block (`accept`: after the rule check; `book`: `:257–272`). Move (or duplicate into an earlier `v_anchor_count / v_anchor_min / v_anchor_max` populate) so a boolean is known before the rule/override gate:
   - `accept_reschedule_proposal`: keep the self-exclude `and s.id <> v_showing_id`.
   - `book_public_showing`: no self-exclude (new showing).
   - Derive `v_is_anchored_day := coalesce(v_cluster_enabled,false) and v_building is not null and v_building <> '' and coalesce(v_anchor_count,0) between 1 and (cap - 1)` where `cap = case when coalesce(v_cluster_cap,0) > 0 then v_cluster_cap else 6 end`.
   - Derive `v_is_synth_day := v_is_anchored_day and coalesce(v_override_count,0) = 0 and not exists(<weekly rule for v_dow>)`. (Compute `v_override_count` and the day-off check *before* this, as today.) Day-off still returns `not_available`/raises **before** any synthesis — unchanged and absolute.

2. **Bypass the rule/override rejection on a synthesized day.** In the `elsif not exists(<availability_rules...>)` branch (`accept`: the rule block; `book`: `:245`), only reject when **`not v_is_synth_day`**. When `v_is_synth_day`, skip the "not an offered showing time" rejection — the clustering block below becomes the authoritative slot gate. The `override_count > 0` branch is unchanged (a day with overrides is never synthesized).

3. **Make the clustering block enforce the full grid on synthesized days.** In the existing `if coalesce(v_cluster_enabled,false)` block (`book`: `:255–283`; `accept`: analogous):
   - Keep the cap check (`v_anchor_count >= cap ⇒ reject`) and the window check (`p_slot < v_anchor_min − buffer or p_slot > v_anchor_max + buffer ⇒ reject`) exactly as today.
   - **Add, gated on `v_is_synth_day`, a step-alignment check** so the SQL grid equals the JS grid: with `v_lo := v_anchor_min − make_interval(mins => greatest(0, coalesce(v_cluster_buffer,60)))`, reject unless `(extract(epoch from (p_slot - v_lo))::bigint % (v_slot_min * 60)) = 0`. (On covered anchored days the rule's modulo check already fixes the step, so this extra check is synth-only.)

4. **Lead relaxation — `accept_reschedule_proposal` ONLY.** Guard the lead-floor check (`if p_slot < now() + make_interval(hours => coalesce(v_lead_hours,0))`) with `and not v_is_anchored_day` so the `booking_lead_hours` floor is waived on anchored days (matching the operator picker). Keep the strict-future guard `if p_slot <= now()` untouched. **`book_public_showing` keeps its lead check unconditional — never relaxed.**

Everything else — horizon bound, seconds check, `taken` check, the `update`/`insert`, proposal status flip, `messages` row, return JSON, grants, `unique_violation`/`others` handlers — stays byte-for-byte.

---

## Guardrails / invariants
- `buildingKey()` (JS) / `public.building_key` (SQL) remain the single "same building" source of truth. (Known abbr-fold drift is pre-existing; do not touch it here.)
- `days_off` always wins; never synthesize or accept on a day-off.
- Capacity is the S499 self-exclude everywhere: exclude the moving showing before counting anchors, enforce `cap` at validation/acceptance — **do not** trim the number of shown options.
- Renter/public lead time is **never** relaxed (JS default flag + unconditional `book_public_showing` lead check).
- No new column/table. `0152` is `create or replace function` for exactly the two functions.
- `proposeShowingTimes`, `sendRescheduleProposal`, reminder routes, and Part C's `lib/reminders.ts` are untouched.

## Verification
- **JS unit tests** (extend the booking suite): (a) fully opt-in-closed org, one anchored day within horizon → operator `generateSlots` offers the synthesized `[lo,hi]` grid stepped by `slotMin`, all `clustered:true`; (b) same org, renter `generateSlots` (no flag) → synthesized grid present **but** slots inside the lead window are dropped; (c) day-off that is also anchored → still zero slots; (d) anchored day already at `cap` → zero slots; (e) covered anchored day (has a rule) → unchanged slot set, plus operator flag relaxes its lead floor while renter does not; (f) clustering disabled → output identical to before this change.
- **SQL parity tests** (the core of this ticket): for the same fixtures, assert `accept_reschedule_proposal` **accepts** each operator-grid slot the JS operator picker shows and **rejects** an off-grid / out-of-window / over-cap / day-off slot; assert `book_public_showing` accepts each renter-grid slot and **rejects** any slot inside the lead window (proving no renter relaxation). Explicitly assert the JS grid and the RPC-accepted set are identical on a synthesized day.
- `tsc --noEmit` + lint + `next build` clean (Noam runs the gate).
- Cowork verifies the diff via `device_bash git` in the MAIN context: only `lib/booking.ts`, the two operator callers, tests, and `supabase/migrations/0152_*.sql`; migration recreates exactly the two functions with the payload/SELECTs unchanged; public path and Part C files untouched.

## Migration / deploy sequencing (IMPORTANT)
`0152` **replaces `accept_reschedule_proposal`**, the function Brien's live pending accept (proposal `91f22d66`, showing `0b593be1`) runs through. Build, test, and diff-verify freely now, but **hold the `0152` prod apply + the push until Brien's pending proposal resolves** (he accepts, or it expires) so the function is not swapped under a live 1-tap accept. Parity tests must pass a normal (non-synthesized) accept before deploy so Brien's ordinary accept is provably unaffected either way.

## Out of scope
Part B — reschedule-proposal re-reminder cron + `reminded_at` migration + the notification-semantics decision (new `NOTIFICATION_EVENTS` entry vs. a per-org on/off for the direct renter email). Separate ticket after this ships.
