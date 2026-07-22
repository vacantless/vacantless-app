# CODEX BUILD — Open-house double-booking (per-org toggle), S514

**Scope: the whole feature in one slice.** A per-org `allow_double_booking` toggle (default
OFF) that makes an org's viewing times stay **publicly bookable after they're booked**
(open-house), so multiple renters can self-book the same slot. Full design + rationale:
`claude/DESIGN-OPEN-HOUSE-DOUBLE-BOOKING-S514.md`.

App HEAD at spec time: `97362c6`. Latest migration: `0158`. **Use `0159`.**

**Verified facts you are building on (do not re-litigate):**
- The single-booking guard is ONE partial unique index `showings_org_slot_unique on
  public.showings (organization_id, scheduled_at) where outcome='scheduled'` (`0004`).
- `book_public_showing` + `accept_reschedule_proposal` (`0154`) have **no booked-slot check** —
  their only double-booking guard is that index (`when unique_violation then raise ...`). So
  once the index permits the insert, they need **NO change**.
- `get_public_availability` (`0148`) returns `booked = jsonb_agg(scheduled_at) where
  outcome='scheduled' and scheduled_at >= now()`; the `/r` page subtracts it. This is what
  removes taken slots from the renter's view.
- The clustering toggle already lives on `/dashboard/availability` — put the new toggle there.

---

## File 1 — `supabase/migrations/0159_allow_double_booking.sql` (Codex writes; Cowork applies via Supabase MCP)

```sql
alter table public.organizations
  add column if not exists allow_double_booking boolean not null default false;

alter table public.showings
  add column if not exists slot_lock text;

update public.showings s
set slot_lock = s.scheduled_at::text
where slot_lock is null;

create or replace function public.set_showing_slot_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_allow boolean;
begin
  if tg_op = 'UPDATE'
     and new.scheduled_at is not distinct from old.scheduled_at
     and new.organization_id is not distinct from old.organization_id
     and new.slot_lock is not null then
    return new;
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

drop index if exists showings_org_slot_unique;
create unique index if not exists showings_org_slot_unique
  on public.showings (organization_id, slot_lock)
  where outcome = 'scheduled';
```
No RLS change. `gen_random_uuid()` is core (PG17). The trigger is the ONLY place that sets
`slot_lock`; do not set it from application code.

## File 2 — `get_public_availability` (new migration statement in `0159`, or a paired file)

Replace the RPC body's `booked` field so it is empty when the org allows double-booking. Load
the flag with the existing org-settings select (add `o.allow_double_booking` into the same
`select ... into ...`), then:
```sql
'booked', case when v_allow_double then '[]'::jsonb
               else coalesce((select jsonb_agg(s.scheduled_at)
                              from public.showings s
                              where s.property_id = ... /* keep the existing WHERE exactly */
                                and s.outcome = 'scheduled'
                                and s.scheduled_at >= now()), '[]'::jsonb) end,
```
Change ONLY the `booked` field. Leave `cluster_candidates`, slots, days_off, overrides, and
every other field byte-identical. Re-create the function with `create or replace` inside the
same `0159` migration (keep its signature/return/security/search_path exactly as the `0148`
definition). Do not touch clustering logic.

## File 3 — `app/dashboard/availability/actions.ts`

Add a server action mirroring the existing clustering-toggle action:
```ts
export async function setAllowDoubleBooking(enabled: boolean) { ... }
```
Same authz (owner_admin/operator for their org), same org-scoped update
(`organizations.allow_double_booking = enabled`), `revalidatePath('/dashboard/availability')`.
No new RLS, no new RPC. If the clustering toggle uses a shared helper/pattern, reuse it.

## File 4 — `app/dashboard/availability/page.tsx`

Add ONE toggle next to the clustering toggle. Reads `organizations.allow_double_booking`.
- Label: **"Open-house booking — allow multiple bookings per time"**
- Help text: "When on, a viewing time stays bookable even after someone books it, so several
  renters can book the same slot. When off (default), each time can be booked once."
- Wire it to `setAllowDoubleBooking`. Match the existing toggle's markup/interaction so it
  looks native. No sub-options, no cap field.

## File 5 — test

Add a test proving the mechanics. Prefer a SQL/tsx harness that:
- with `allow_double_booking=false`: two `insert ... 'scheduled'` at the same `(org, time)` →
  the second raises `unique_violation`.
- with `allow_double_booking=true`: two inserts at the same `(org, time)` BOTH succeed with
  distinct `slot_lock`.
- backfilled/legacy rows have `slot_lock = scheduled_at::text`.
- `get_public_availability`: opted org → `booked = []`; non-opted org → `booked` lists the
  scheduled times.
If the repo has no DB-integration harness, at minimum add a tsx test for the toggle action's
pure authz/update shaping and document the SQL checks for Cowork to run at verify time.

## Guardrails / must-nots

- Do **NOT** change `book_public_showing` or `accept_reschedule_proposal` — the index
  relaxation is sufficient; their `unique_violation` handlers stay as the non-opted-org
  backstop.
- Do **NOT** set `slot_lock` from application code — the trigger owns it.
- Do **NOT** drop the unique index without recreating it keyed on `slot_lock` (same partial
  predicate) in the same migration — never leave a window with no guard.
- For a non-opted org, behaviour MUST be byte-identical to today (single booking per time,
  `booked` still populated). Confirm by diffing `get_public_availability` output for a
  non-opted org before/after.
- Default `allow_double_booking = false`. Do not enable any org in the migration.
- Migration goes to prod via Supabase MCP; Codex writes the file(s) only.

## Verify (Cowork, after Codex returns)

1. `device_bash git diff` in MAIN — only the files above; `git diff --check` clean; Codex did
   not apply the migration.
2. Read the `0159` SQL + the `get_public_availability` re-def; confirm only `booked` changed
   and the trigger/index logic matches this ticket.
3. Apply `0159` via Supabase MCP. Rolled-back SQL functest: prove the false/true insert
   behaviour + backfill + `booked` bypass on a throwaway org, then roll back.
4. Noam pushes; Vercel READY.
5. Flip Agile `allow_double_booking = true`; browser-verify on `/r` that a slot stays offered
   after one booking and a second renter can book the same time; confirm both showings exist
   with distinct `slot_lock`. Then confirm a non-opted org still single-books.
