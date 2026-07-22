# CODEX BUILD - S506: Clustering must never open slots outside operator availability windows

_Written 2026-07-16. Grounded at app HEAD 1581473. Design-first; NOT built yet._
_Re-verified 2026-07-16 (Session 7) against MAIN HEAD 1581473 via device_bash git: JS branch, both RPCs, and migration numbering all confirmed accurate. Load-bearing RPC edit named in the Verification Addendum at the bottom._

## Problem (live correctness bug, paying customer)

Agile (org 921f7c08, first paying Vacantless customer) runs an OPT-IN viewing calendar: unset days are supposed to be CLOSED (no `availability_rules`; only per-date `availability_overrides` open a day). The operator (Aaliyah) set Jul 16 to 6pm-9pm intent, yet renters were offered and booked 5:00 and 5:30 slots - hours before her start and outside coverage (Hana off at 5). This nearly cost the operator's trust in the product.

Root cause (confirmed by reading `lib/booking.ts` + org config): showing clustering (S503) with `clustering_buffer_minutes=120` SYNTHESIZES bookable slots on a day that has NO operator window, from `min(anchor)-buffer .. max(anchor)+buffer`, ignoring operator hours entirely. On Jul 16 a 7:30pm anchor produced `7:30 - 120min = 5:30` (Larry); a 6:30 anchor produced a 4:30 band (Eric 5:00). So clustering silently REOPENS days the operator deliberately left closed, at times she never approved.

Interim mitigation already applied: `organizations.clustering_enabled=false` for Agile (via Supabase, 2026-07-16). This ticket is the permanent fix so clustering can be safely re-enabled.

## Principle (from Noam)

Clustering must NEVER override operator availability windows. It may only NARROW, within a set window, to slots near an existing showing. It must not OPEN a day the operator has not opened, and must not reach outside the operator's set hours on any day.

## Exact change

### 1. `lib/booking.ts` `generateSlots`

The ONLY offending path is the closed-day synthesis branch (confirmed at L276-285 on HEAD 1581473):

```ts
if (!rules || rules.length === 0) {
  if (!isAnchored || !anchors) continue;
  const lo = Math.min(...anchors) - bufferMs;
  const hi = Math.max(...anchors) + bufferMs;
  for (let t = lo; t <= hi; t += slotMin * 60_000) {
    if (relaxLead ? t <= now.getTime() : t < earliest) continue;
    if (booked.has(t)) continue;
    const iso = new Date(t).toISOString();
    slots.push({ iso, label: fmtTime(iso, tz), clustered: true });
  }
} else {
  // window path (rules/overrides) - CORRECT, leave as-is
}
```

Fix: a day with no rule/override must yield NO slots, regardless of anchors. Replace the synthesis branch so it simply skips:

```ts
if (!rules || rules.length === 0) {
  continue; // opt-in: a day the operator has not opened stays CLOSED, even if a showing exists on it
}
// ... window path unchanged
```

Effect: clustering no longer manufactures closed-day slots. The windowed path + `clusterDays` post-filter already keep clustered slots INSIDE the window (`clusterDays` only filters the window-generated slots to those within `[min(anchor)-buffer, max(anchor)+buffer]`), so within-window narrowing is preserved and correct - do NOT change `clusterDays`.

Notes:
- `anchorsByDay` / `isAnchored` are now only relevant to `relaxLeadForAnchoredDays` on windowed days. Keep that behavior for windowed anchored days; it no longer applies to closed days (there are none to relax).
- `buildingKey`, `clusterDays`, `groupShowingsIntoBlocks` (operator route view) are UNCHANGED.

### 2. Booking RPCs - parity migration (REQUIRED)

The same closed-day synthesis is mirrored in the two SQL functions from migration 0152: `accept_reschedule_proposal` and `book_public_showing`. Per the parity contract (KI793/KI794), the JS grid and both RPC-accepted slot sets must match byte-for-byte or a shown slot 404s on accept (or, worse here, an off-hours slot stays acceptable even after the JS stops offering it).

Add a NEW migration (`0154_*`; migrations end at 0153 on HEAD 1581473 with no unpushed WIP - confirmed) that create-or-replaces BOTH functions so they ALSO produce no slots for a day with no window (remove their closed-day synthesis), keeping every other behavior identical. No schema change.

**Load-bearing SQL edit (see Verification Addendum for line refs):** in each function the windowless-day acceptance is gated by a `v_is_synth_day` flag. A closed anchored day is accepted only because the window-membership guard is written `elsif not v_is_synth_day and not exists (<availability_rules match>) then return not_available`. The fix:
- **Drop the `not v_is_synth_day` bypass** so the guard becomes `elsif not exists (<availability_rules match>) then return not_available` - i.e. any slot on a day with no override AND no matching weekday rule is rejected (the SQL parallel of the JS `continue`).
- **Remove the now-dead synth-stepping block** (`if v_is_synth_day then ... v_synth_lo ... end if;`) inside the clustering section, and the `v_is_synth_day` declaration/assignment.
- KEEP `v_is_anchored_day` and its lead-time relaxation (`and not v_is_anchored_day` on the lead guard) - that mirrors `relaxLeadForAnchoredDays` and still applies to WINDOWED anchored days.
- KEEP the within-window clustering band check (`p_slot < v_anchor_min - buffer or p_slot > v_anchor_max + buffer => not_available`) - that is the correct within-window narrowing.

## Out of scope / keep

- Do not change `clustering_buffer_minutes` semantics (still governs within-window narrowing).
- Do not re-enable clustering for Agile in this ticket; that is a separate Noam-gated flag flip AFTER this ships and is verified.
- Non-clustering orgs and days-off logic unchanged.

## Tests

- `generateSlots`: day with NO window + an anchor => `[]`. Day with 6-9 window + a 7:30 anchor + buffer 120 => only in-window slots (>=6:00, <=8:30 intersected with the window), NONE before 6:00. Non-anchored windowed day unchanged.
- Parity: for both cases, the RPC-accepted set equals the JS grid (add/extend the existing booking-parity tests). Explicitly assert: a windowless anchored day => `accept_reschedule_proposal` and `book_public_showing` both return `not_available` for a would-be synth slot.
- Regression: within-window clustered narrowing still works; a closed day never yields a slot.

## Verify after deploy

1. Browser: on a CLOSED day (no override), Agile's renter `/r` booking page AND the operator "suggest a new time" picker show zero slots even when a showing already exists that day.
2. On an OPEN day, only in-window slots appear, none before the window start.
3. Then (Noam-gated) re-enable `clustering_enabled=true` for Agile and re-confirm no pre-window slots appear.

## Handoff

- Verify the diff via `device_bash` git in MAIN before deploy. Migration to prod via Supabase MCP. Push is Noam's (`rm -f .git/index.lock` first).
- This is the TOP next build, ahead of S505 (IA Slice-2), because it is a live correctness bug affecting the paying customer's operator trust.

---

## Verification Addendum (Session 7, 2026-07-16, re-checked against MAIN HEAD 1581473)

Confirmed via `device_bash` git in the connected repo (`vacantless-app`, branch `main`, HEAD 1581473):

- **JS:** `lib/booking.ts generateSlots` closed-day synthesis is at **L276-285**. Fix = replace the whole `if (!rules || rules.length === 0) { ... }` body with `continue;`. `clusterDays` (L382+) filters only already-windowed slots, so within-window narrowing is preserved - leave it alone.
- **RPCs (migration `0152_clustering_open_covered_day.sql`, 572 lines):**
  - `accept_reschedule_proposal` at **L5**; `v_is_synth_day` assigned **~L171-178**; window guard `elsif not v_is_synth_day and not exists(...)` **~L195-206**; synth stepping block `if v_is_synth_day then ... end if;` **~L232-238**.
  - `book_public_showing` at **L322**; the same three constructs at **~L468-478 / ~L491-502 / (synth block just after)**.
  - Both are near-verbatim copies; apply the identical edit to each.
- **Migrations** end at `0153_reschedule_nudge.sql`; no unpushed WIP migration files (`git status` clean of migration adds). Next number = **0154**.
- No other file references the closed-day synth path (`buildingKey`, `groupShowingsIntoBlocks`, showing-times mirror at booking.ts L550+ are read-through and need no change once generateSlots stops emitting closed-day slots - but a quick grep for `v_is_synth_day` / `clustered: true` before finalizing is cheap insurance).
