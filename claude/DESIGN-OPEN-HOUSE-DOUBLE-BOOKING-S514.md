# DESIGN — Open-house double-booking (per-org toggle), S514

**Design thread #4.** Date: 2026-07-18 (session 514). Status: DESIGN.
App HEAD at design time: `97362c6`. Latest migration: `0158` (availability tripwire).
**Next free migration: `0159`.**

Decisions locked with Noam this session:
- **Shape B — open-house.** For an opted-in org, a viewing time stays **publicly bookable
  even after someone books it**, so multiple renters can self-book the same slot. (NOT the
  "operator manually stacks, renters can't" shape.)
- **Per-org setting**, default **OFF** — like `clustering_enabled`. Never global.
- **A simple toggle**, living where the operator already manages booking rules:
  `/dashboard/availability` (the page that already holds the clustering toggle + booking
  window settings). No new page, no new nav.
- **Unlimited overlaps** (no cap). The operator owns their calendar (BrokerBay/open-house
  model). A per-org cap is a cheap, reversible future add if ever wanted (§7).

---

## 1. Why

Today every viewing time is single-use: once one renter books 6:00pm, that slot disappears
for everyone else. Some operators run **open-house-style** showings — several renters seen at
the same time — and want a time to stay bookable. Proven-needed on Agile: the Chijoke /
Madelaine case, where the operator had to hand-create a second showing at a **30-second
offset** to dodge the single-booking guard. This makes that a first-class, per-org setting.

## 2. What enforces single-booking today (verified 2026-07-18 via device_bash git)

- **The guard is ONE partial unique index:** `showings_org_slot_unique on
  public.showings (organization_id, scheduled_at) where outcome = 'scheduled'`
  (`supabase/migrations/0004_m3_booking.sql`, never modified since). Cancelled/completed
  showings are excluded, so a freed slot can rebook.
- **The renter never SEES a taken slot.** `get_public_availability`
  (`supabase/migrations/0148_availability_overrides.sql`) returns a `booked` array =
  `jsonb_agg(s.scheduled_at) where outcome='scheduled' and scheduled_at >= now()`; the
  booking page (`app/r/[propertyId]/inquiry-form.tsx`) subtracts `booked` from the offered
  slots. So a booked time simply vanishes from the page.
- **`book_public_showing`** (`0154_clustering_respect_windows.sql`) validates only
  **availability** — listing available, not past, within lead-time/horizon, matches an
  offered window/override, clustering rules. It has **NO booked-slot check**; the sole
  double-booking guard is the unique index → `when unique_violation then raise exception
  'That time was just taken'`. `accept_reschedule_proposal` (same file) mirrors this with its
  own `unique_violation` handler.
- **There is no operator "create a new showing" path.** All scheduled showings originate from
  `book_public_showing` (renter self-serve via `/r`). The dashboard only reschedules /
  assigns / records outcomes. => Shape B is the natural fit: keep the slot offered on `/r`
  and let the renters book it themselves.
- **Consequence:** to allow visible double-booking we need exactly two behavioural changes —
  (a) stop consuming the slot in `get_public_availability`, and (b) relax the unique index —
  both gated on the per-org flag. `book_public_showing` needs **no change** (its guards are
  availability-only; once the index permits the insert, it succeeds).

## 3. The model (Shape B, open-house)

For an org with `allow_double_booking = true`:
- Every offered viewing slot stays bookable regardless of how many showings already sit on it
  (unlimited). Renters self-book via the normal `/r` flow; each booking creates its own
  `scheduled` showing at the same `scheduled_at`.
- For every OTHER org (`false`, the default), behaviour is **byte-identical to today** — one
  scheduled showing per `(org, time)`, enforced at the DB.

## 4. Surface (4 pieces + a data flip)

### 4.1 Migration `0159` — org flag + the slot_lock relaxation

```sql
-- (a) the per-org toggle
alter table public.organizations
  add column if not exists allow_double_booking boolean not null default false;

-- (b) a per-row uniqueness key that lets opted orgs stack while every other org
--     keeps the exact single-booking guard. NULL-free so the partial index stays selective.
alter table public.showings
  add column if not exists slot_lock text;

-- (c) backfill existing rows to the current guard semantics
update public.showings s
set slot_lock = s.scheduled_at::text
where slot_lock is null;

-- (d) trigger: set slot_lock from the org flag at write time. For a non-opted org the lock
--     IS the timestamp (two scheduled showings at one time collide -> guard intact). For an
--     opted org the lock is a fresh uuid (never collides -> overlaps allowed). Path-agnostic:
--     covers book_public_showing, accept_reschedule_proposal, and any future writer.
create or replace function public.set_showing_slot_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_allow boolean;
begin
  if tg_op = 'UPDATE'
     and new.scheduled_at is not distinct from old.scheduled_at
     and new.organization_id is not distinct from old.organization_id
     and new.slot_lock is not null then
    return new;  -- non-time update: keep existing lock (no churn)
  end if;
  select coalesce(o.allow_double_booking, false) into v_allow
    from public.organizations o where o.id = new.organization_id;
  new.slot_lock := case when v_allow then gen_random_uuid()::text
                        else new.scheduled_at::text end;
  return new;
end $$;

drop trigger if exists trg_set_showing_slot_lock on public.showings;
create trigger trg_set_showing_slot_lock
  before insert or update on public.showings
  for each row execute function public.set_showing_slot_lock();

-- (e) swap the guard to key on slot_lock (same partial predicate)
drop index if exists showings_org_slot_unique;
create unique index if not exists showings_org_slot_unique
  on public.showings (organization_id, slot_lock)
  where outcome = 'scheduled';
```

Notes:
- `gen_random_uuid()` is core in PG13+ (prod is PG17). No extension needed.
- The trigger reads `organizations.allow_double_booking` per write — low volume, fine.
- The unique index still keys on `(organization_id, slot_lock)` with the SAME
  `where outcome='scheduled'` predicate, so cancelled/completed showings still free the time,
  and the `unique_violation` handlers in both booking RPCs keep working as the non-opted-org
  backstop.

### 4.2 `get_public_availability` — stop consuming slots for opted orgs

In the RPC (currently in `0148`), the `booked` field is
`jsonb_agg(s.scheduled_at) where outcome='scheduled' and scheduled_at >= now()`. Wrap it so
that when the org's `allow_double_booking` is true, `booked` returns `'[]'::jsonb`:

```sql
'booked', case when v_allow_double then '[]'::jsonb
               else coalesce((select jsonb_agg(s.scheduled_at) ...), '[]'::jsonb) end,
```
Load `v_allow_double` from `organizations` alongside the existing org settings select. Only
the `booked` array changes; `cluster_candidates` and everything else stay exactly as-is
(clustering is a separate concern and stays correct). This single conditional is what keeps
every offered slot on the page after a booking.

### 4.3 UI — the toggle on `/dashboard/availability`

- `app/dashboard/availability/page.tsx` already renders the booking-rules controls incl. the
  clustering toggle. Add one more toggle card/row **next to it**:
  - Label: **"Open-house booking — allow multiple bookings per time"**
  - Help: "When on, a viewing time stays bookable even after someone books it, so several
    renters can book the same slot. When off (default), each time can be booked once."
  - Reads `organizations.allow_double_booking`.
- `app/dashboard/availability/actions.ts`: add a `setAllowDoubleBooking(enabled: boolean)`
  server action mirroring the existing clustering-toggle action (owner/operator authz,
  org-scoped update, `revalidatePath('/dashboard/availability')`). No new RLS.
- Keep it dead simple: one boolean, no sub-options, no cap field in v1.

### 4.4 Enable for Agile

Because it's a UI toggle now, Aaliyah/Noam can flip it themselves. For dogfood, flip it on for
Agile (`921f7c08…`) once deployed — via the toggle or a one-line data update. Default stays
OFF for every other org.

## 5. Interactions / edge cases (call out, don't over-engineer)

- **Clustering:** OFF for Agile, and orthogonal — clustering shapes WHICH slots are offered;
  double-booking changes whether an offered slot is consumed. They compose. Note only.
- **Reschedule (`accept_reschedule_proposal`):** covered by the trigger (BEFORE UPDATE
  recomputes `slot_lock` when `scheduled_at` changes). Its `unique_violation` handler stays a
  backstop for non-opted orgs.
- **Toggling OFF while stacks exist:** already-stacked rows keep their uuid `slot_lock`;
  turning the flag off only prevents NEW overlaps. A brand-new booking onto a time that still
  has uuid-locked stacks won't collide with them (they're uuid-locked), so it succeeds. This
  is acceptable for v1 — document it; a "re-lock on disable" backfill is out of scope.
- **Operator dashboard availability view:** if it also reads `get_public_availability`, an
  opted org will show slots as always-open — correct for open-house.
- **Confirmation / reminder / capacity emails:** unchanged; each showing is a normal row.

## 6. Tests

- A DB-level functest (or a rolled-back SQL check via Supabase MCP at build/verify time):
  with `allow_double_booking=false`, a second `insert ... 'scheduled'` at the same
  `(org, time)` raises `unique_violation`; with `true`, two inserts at the same time BOTH
  succeed and carry distinct `slot_lock`. Backfilled rows have `slot_lock = scheduled_at::text`.
- `get_public_availability`: for an opted org, `booked` comes back `[]`; for a non-opted org,
  `booked` still lists the scheduled times. (tsx or SQL harness.)
- The toggle action: authz + org-scoped write + revalidate (mirror the clustering-toggle test
  if one exists).

## 7. Out of scope for v1 (reversible future adds)

- **Per-slot cap** (e.g. max N per time): would move the guard from "index" to "RPC counts
  concurrent scheduled showings and rejects the N+1th" — a real behavioural change that fights
  the clean slot_lock design. Add an `allow_double_booking_cap int` column + an explicit count
  check in `book_public_showing` only if an operator asks for it.
- Operator "manually stack a showing onto any slot" action (Shape A) — not built; the
  open-house public flow covers the stated need.
- Re-lock-on-disable backfill (see §5).

## 8. Build staging

Single slice: mig `0159` (flag + slot_lock + trigger + index swap) + `get_public_availability`
booked bypass + the `/dashboard/availability` toggle + action + tests. Deploy, flip Agile on,
browser-verify two renters can book the same time.
