# Codex Build Ticket — S499: Suggest-a-new-time move-capacity fix + `building_key` SQL/TS alignment (+ IA decisions)

**Date:** 2026-07-16 · **Author:** Cowork (grounded against real code on the Mac) · **Status:** IMPLEMENTATION-READY — build on the Mac
**Base:** HEAD `9302136` (S498b, clean tree), migration ledger through `0149`. **This slice ADDS migrations `0150` and (optionally) `0151`.**
**Repo:** `.../Agile Lead to Lease Engine/vacantless-app`
**Origin:** Codex Review Verdict (2026-07-16). Both P2 findings were re-verified by Cowork against the live code before this ticket was written; file/line anchors below are confirmed.

> ### Read this first
> This ticket turns the Codex Review Verdict into buildable work. It is **two correctness fixes** (Part A, Part B) plus **two small IA decisions Codex endorsed** (Part C). It is **not** a new syndication channel. Priorities: **Part A is a real operator-facing bug (ship it). Part B is an edge-case data-integrity fix with migration risk (ship only after the pre-check in B0). Part C is light.**
> Do **not** touch the S498/S498b surfaces (webhook self-heal, renter confirm route), the distribution/publish co-pilot write paths, or billing.

---

## PART A — `accept_reschedule_proposal` over-restricts a move when the building/day block is already full  *(P2 — ship)*

**File:** `supabase/migrations/0149_showing_reschedule_proposals.sql` → function `public.accept_reschedule_proposal(...)`, clustering block (verified at L262–297 in the deployed function).

**Root cause (verified).** The move-validation clustering block was copied *verbatim* from the 0148 insert guard, which is correct for a **new** showing (the new row doesn't exist yet). But on a **move**, the showing being rescheduled already exists as a `'scheduled'` row in the same building on the same day, so it counts itself as an anchor:

```sql
select count(*), min(s.scheduled_at), max(s.scheduled_at)
  into v_anchor_count, v_anchor_min, v_anchor_max
from public.showings s
join public.properties cp on cp.id = s.property_id
where s.organization_id = v_org
  and cp.building_key = v_building
  and cp.status <> 'off_market'
  and s.outcome = 'scheduled'
  and s.scheduled_at >= now()
  and (... )::date = (v_local)::date;
-- ^ does NOT exclude v_showing_id
...
if v_anchor_count >= (case when coalesce(v_cluster_cap,0) > 0 then v_cluster_cap else 6 end) then
  return jsonb_build_object('ok', false, 'reason', 'not_available');
```

Note the *slot-taken* check immediately above **does** exclude it (`and s.id <> v_showing_id`); only the clustering count omits it. Net effect: when a building/day block is **at cap**, an operator/renter cannot move an existing viewing to another time **within that same block**, even though the total count would not increase — the move is falsely rejected `not_available`.

**Fix.** Add `and s.id <> v_showing_id` to the anchor select so the moving showing is excluded from **both** the capacity count **and** the min/max window (the window should be anchored by the *other* showings, since this one is leaving its current slot). Ship as **new migration `0150`** = `create or replace function public.accept_reschedule_proposal(...)` with the one-line exclusion added; do not rewrite the rest of the function.

**Operator proposal picker must be move-aware too.** When the operator picks candidate times to *propose* (the "suggest a new time" surface — `app/dashboard/showings/actions.ts` / `app/dashboard/showings/page.tsx`, availability derived via `lib/booking.ts`), the same self-exclusion must apply so a full block doesn't hide all in-block slots from the picker. Thread an optional `excludeShowingId` through the availability/clustering computation used by the picker and pass the current showing's id. If the picker already reuses the RPC's view of availability, ensure it exercises the same self-excluding path.

**Tests (`scripts/test-reschedule-proposal.ts`, currently 16/0):** add a case — building at cap (N = cluster_cap, same building/day), move one of those N showings to a different valid in-block slot → **accept succeeds** (was `not_available`). Keep a case proving a *new* booking into a full block is still rejected (0148 unchanged). Add a picker case if the picker path has unit coverage.

---

## PART B — SQL `building_key` does not fold street-type abbreviations; TS `buildingKey` does  *(P2/P3 — ship only after B0)*

**Files:** `lib/booking.ts` `buildingKey()` (STREET_ABBR map, verified ~L287–320) vs `supabase/migrations/0049_building_policy_override.sql` `public.building_key(text)` (verified L51–77).

**Root cause (verified).** TS `buildingKey()` folds `road→rd`, `street→st`, `avenue→ave`, `drive→dr`, `boulevard→blvd`, … so `"123 Elm Road"` and `"123 Elm Rd"` produce the **same** key. SQL `public.building_key(p_address)` lowercases, strips the unit/`#` segment, collapses whitespace, trims edge commas — **no abbreviation folding**. So the two spellings yield **different** SQL keys.

**Why it matters.** DB-side clustering enforcement (the 0148 booking guard and the 0150 move guard from Part A) joins on `properties.building_key` — a **STORED GENERATED** column `generated always as (public.building_key(address)) stored` (0049 L82–88). The per-building policy override (`org_building_policies`, unique per `(org, building_key)`) also keys on it. So for a building whose units were entered with **mixed** street-type spellings, the DB treats them as *different buildings*: clustering isn't enforced across them and a per-building override applies to only some units — while the TS operator Showings view groups them correctly. Same-spelling units are unaffected (already enforced).

### B0 — Pre-check (Cowork ran this 2026-07-16 → **Part B defers**)
**Result:** Agile (org 921f7c08) has one building — `833 Pillette Rd`, Units 3–34 — all spelled "Rd", all sharing `building_key = "833 pillette rd"`. **No mixed street-type spellings exist in real data**, so the divergence does not currently mis-cluster anything. **Recommendation: DEFER the B1–B3 recompute migration.** Ship only **B4** (the parity test) as a regression guard, and leave a one-line code comment in `0049`/`lib/booking.ts` noting the known-and-intentional-for-now TS/SQL divergence. Re-open B1–B3 the first time a building is onboarded with mixed spellings (the parity test will make the gap obvious). The B1–B3 spec below stays as the ready recipe for that day.

### B1 — Align the SQL function (migration `0151`)
Extend `public.building_key(text)` to fold the **same** street-type abbreviations as `STREET_ABBR` in `lib/booking.ts`. Keep it a single source list — mirror the TS map exactly (fold long→short: `road→rd`, `street→st`, `avenue→ave`/`av→ave`, `drive→dr`, `boulevard→blvd`, `court→ct`/`crt→ct`, `crescent→cres`/`cr→cres`, `lane→ln`, `place→pl`, `terrace→ter`, `parkway→pkwy`, `highway→hwy`, `circle→cir`, `square→sq`, `trail→trl`). Function stays `IMMUTABLE` (required — it backs the generated column). Apply folding as word-bounded replacements **after** unit-stripping and whitespace collapse, matching the TS order.

### B2 — Recompute the stored column + rebuild the index (the tricky part)
A STORED generated column does **not** recompute when its function changes. You must force a recompute:
1. Drop the dependent index `properties_org_building_key_idx`.
2. Drop and re-add `properties.building_key` as `generated always as (public.building_key(address)) stored` (re-adding recomputes every row against the new function).
3. Recreate `properties_org_building_key_idx on public.properties(organization_id, building_key)`.

### B3 — Re-key `org_building_policies` (data migration — do NOT skip)
Existing override rows are keyed on the **old** normalization and will stop matching the recomputed `properties.building_key`. Because the new normalization = old normalization **+** idempotent abbreviation folding, re-key in place by folding the stored key through the updated function:
```sql
update public.org_building_policies o
   set building_key = public.building_key(o.building_key);
```
**Open question B-i:** this can create **unique-constraint collisions** if two old keys fold to one new key (e.g. a building entered as both "Rd" and "Road" that had two override rows). Decide the merge rule (keep the most-recently-updated row / coalesce non-null policy fields) and de-dupe **before** the update, or wrap so the migration fails loudly rather than silently dropping a policy. Flag any collisions found.

### B4 — Tests
Add SQL/TS parity coverage: a small table of address pairs (`"123 Elm Road"` / `"123 Elm Rd"`, `"5 King Street"` / `"5 King St"`, plus a unit-suffixed pair) asserting `lib/booking.ts buildingKey()` **and** `public.building_key()` produce identical keys. If there's an existing booking/building test (`scripts/test-booking.ts`, 60/0), extend it; otherwise add `scripts/test-building-key-parity.ts`. Assert idempotency: `building_key(building_key(x)) = building_key(x)`.

---

## PART C — IA / navigation decisions Codex endorsed  *(light — decide, don't over-build)*

**C1. Distribution stays where it is.** Codex's navigation answer: a top-level **Distribution** nav item makes sense **only** for account/channel-level *setup* — **active publishing belongs on the per-property `Distribute` surface**, which the current bridge already does (`app/dashboard/properties/[id]/launch-run-panel.tsx`). **Do NOT** add a heavy top-level Distribution publishing lane this slice. If anything, a *Settings → Distribution* section for account/channel setup is the only justified addition, and only if there's real account-level config to house there — otherwise skip.

**C2. "Viewing Times" is already a main nav item.** Confirmed: `app/dashboard/dashboard-nav.tsx` NAV array already has `{ href: "/dashboard/availability", label: "Viewing Times" }`. Codex agreed it belongs in the main operator nav. **No change needed** — this is a confirmation, not a task.

**C3. Settings → Communications is too long a drawer (P3 UX, optional).** Reply-to, test email, renter automations, arrival phone, tenant templates, and SMS all live in one scroll (`app/dashboard/settings/page.tsx`, "Tenant messages" templates section ~L1374). Defaults belong in Settings, but **tenant message templates are point-of-use** (they're authored for sending from a tenancy). The section already carries a "Saved here, used over in Tenancies ↗" banner. Lightweight fix: keep the template **editor** in Settings but lead with the point-of-use link, or move template authoring to a `Tenancies`/`Messages` entry point and leave a stub in Settings. **Only take this if it's a small, self-contained change** — otherwise defer to a dedicated UX slice; do not expand it into a Settings redesign here.

---

## PART D — Invariants to preserve
- **0148 insert guard unchanged.** Part A touches only the **move** path (`accept_reschedule_proposal`); a brand-new booking into a full block must still be rejected.
- **No change to clustering semantics** other than self-exclusion on a move — same cap, same buffer window logic.
- **`building_key` stays `IMMUTABLE`** (Part B) so it can back the generated column.
- **No touch** to: S498 webhook path, S498b confirm route, `completeCopilotPost`/`validateListingPost` distribution write paths, billing/entitlements, notification recipients.

## PART E — Verification (run on the Mac; report results)
```
npx tsx scripts/test-reschedule-proposal.ts     # Part A (was 16/0) — add move-at-cap case
npx tsx scripts/test-booking.ts                  # Part B parity (was 60/0)
npx tsx scripts/test-notifications.ts            # regression (was 104/0)
# + any new scripts/test-building-key-parity.ts
./node_modules/.bin/tsc --noEmit && npm run lint && npm run build
```
Apply `0150` (and `0151` if B ships) to prod via the **Supabase MCP**, idempotently. Cowork will separately live-QA the move path (read-only) on Agile's real board before final sign-off.

## Open questions for Codex
1. **A / picker:** does the operator "suggest a new time" picker already reuse the RPC's availability view (so fixing the RPC fixes the picker), or does it compute slots independently in `lib/booking.ts` and need its own `excludeShowingId`? Name the exact function you threaded it through.
2. **B-i (collisions):** merge rule for `org_building_policies` rows whose keys collide after folding — see B3.
3. **B scope:** if B0 finds no real mixed-spelling buildings, confirm you're deferring B and leaving only the code comment + parity test (guards against future regressions) rather than running the recompute migration.

## Explicitly NOT in this slice
No new syndication channel / distribution card. No top-level Distribution publishing nav. No Settings redesign. No change to the 0148 insert guard, S498/S498b surfaces, co-pilot write paths, or billing. No new co-pilot transport.

## Files expected to change (focused diff)
- `supabase/migrations/0150_reschedule_move_capacity_self_exclude.sql` (new — Part A)
- `app/dashboard/showings/actions.ts` and/or `lib/booking.ts` (Part A picker self-exclusion)
- `supabase/migrations/0151_building_key_street_abbr_align.sql` (new — Part B, if it ships)
- `lib/booking.ts` (Part B: keep as the source-of-truth abbr list / add parity test hook; no behavior change if already folding)
- `app/dashboard/settings/page.tsx` (Part C3, only if taken)
- `scripts/test-reschedule-proposal.ts`, `scripts/test-booking.ts`, (new) `scripts/test-building-key-parity.ts`

**Before final, report:** what changed, what passed (tests/tsc/lint/build), what was intentionally not changed or deferred (esp. Part B if B0 came back empty), and what remains next strategically.
