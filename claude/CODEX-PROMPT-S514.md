TASK: Build S514 — a per-org "open-house double-booking" toggle. When an org turns it ON, a
viewing time stays PUBLICLY bookable even after someone books it, so multiple renters can
self-book the same slot. Default OFF; every other org behaves exactly as today. ONE migration
(0159). A dead-simple toggle on the operator's existing booking-rules page.

════════════════════════════════════════════════════════════════════════
READ FIRST (context — repo-relative paths)
════════════════════════════════════════════════════════════════════════
Primary spec (follow exactly; this reproduces its substance):
  • claude/CODEX-BUILD-OPEN-HOUSE-DOUBLE-BOOKING-S514.md
Design rationale:
  • claude/DESIGN-OPEN-HOUSE-DOUBLE-BOOKING-S514.md

Verified facts you are building on (do NOT re-litigate — confirmed 2026-07-18 via git):
  • The single-booking guard is ONE partial unique index:
      showings_org_slot_unique on public.showings (organization_id, scheduled_at)
      where outcome = 'scheduled'            [supabase/migrations/0004_m3_booking.sql]
  • book_public_showing + accept_reschedule_proposal [supabase/migrations/0154_clustering_respect_windows.sql]
    have NO booked-slot check — their ONLY double-booking guard is that index
    (`when unique_violation then raise exception 'That time was just taken'`). Once the index
    permits the insert, they succeed. => DO NOT MODIFY EITHER RPC.
  • get_public_availability [supabase/migrations/0148_availability_overrides.sql] returns
    `booked = jsonb_agg(s.scheduled_at) where outcome='scheduled' and scheduled_at >= now()`;
    the /r page (app/r/[propertyId]/inquiry-form.tsx) subtracts it. This is what hides taken
    slots. Making `booked` empty for an opted org keeps every slot bookable.
  • The clustering toggle already lives on app/dashboard/availability/page.tsx with its action
    in app/dashboard/availability/actions.ts. Put the new toggle THERE, mirroring it.

════════════════════════════════════════════════════════════════════════
LOCKED DECISIONS (Noam, session 514)
════════════════════════════════════════════════════════════════════════
Open-house shape (slot stays publicly bookable) · per-org setting · default OFF · a SIMPLE
toggle on /dashboard/availability · UNLIMITED overlaps (no cap in v1) · non-opted orgs
byte-identical to today.

════════════════════════════════════════════════════════════════════════
CREATE: supabase/migrations/0159_allow_double_booking.sql   (Codex writes; Cowork applies)
════════════════════════════════════════════════════════════════════════
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
    return new;                        -- non-time update: keep existing lock (no churn)
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
Rationale: for a non-opted org slot_lock = the timestamp (two scheduled showings at one time
collide → guard intact); for an opted org slot_lock = a fresh uuid (never collides → overlaps
allowed). The trigger is the ONLY writer of slot_lock — never set it from app code. gen_random_uuid()
is core in PG17.

════════════════════════════════════════════════════════════════════════
MODIFY (in the SAME 0159 migration): public.get_public_availability
════════════════════════════════════════════════════════════════════════
Re-create the function with `create or replace`, keeping its signature / return type /
`security definer` / `set search_path` / EVERY field EXACTLY as the 0148 definition, changing
ONLY the `booked` field. Add `o.allow_double_booking` to the existing org-settings
`select ... into v_...` and gate booked:
```sql
'booked', case when v_allow_double then '[]'::jsonb
               else coalesce((select jsonb_agg(s.scheduled_at)
                              /* keep the EXISTING from/where byte-for-byte */
                              ), '[]'::jsonb) end,
```
Do NOT touch `cluster_candidates`, slots, days_off, overrides, or anything else. Clustering
logic is unrelated and must stay identical.

════════════════════════════════════════════════════════════════════════
MODIFY: app/dashboard/availability/actions.ts
════════════════════════════════════════════════════════════════════════
Add `setAllowDoubleBooking(enabled: boolean)` mirroring the existing clustering-toggle action:
same authz (owner_admin/operator for their org), org-scoped update of
`organizations.allow_double_booking`, `revalidatePath('/dashboard/availability')`. Reuse any
shared toggle helper the clustering action uses. No new RLS, no new RPC.

════════════════════════════════════════════════════════════════════════
MODIFY: app/dashboard/availability/page.tsx
════════════════════════════════════════════════════════════════════════
Add ONE toggle next to the clustering toggle, reading `organizations.allow_double_booking`:
  • Label: "Open-house booking — allow multiple bookings per time"
  • Help: "When on, a viewing time stays bookable even after someone books it, so several
    renters can book the same slot. When off (default), each time can be booked once."
  • Wire to setAllowDoubleBooking; match the clustering toggle's markup so it looks native.
No sub-options, no cap field.

════════════════════════════════════════════════════════════════════════
CREATE: a test (scripts/test-*.ts, tsx) + document the SQL checks
════════════════════════════════════════════════════════════════════════
Prove: (a) allow_double_booking=false → 2nd scheduled insert at same (org,time) raises
unique_violation; (b) =true → both inserts succeed with distinct slot_lock; (c) legacy rows
have slot_lock = scheduled_at::text; (d) get_public_availability booked=[] for opted org,
populated for non-opted. If there's no DB-integration harness, add a tsx test for the toggle
action's authz/update shaping and write the SQL checks into the ticket's Verify section for
Cowork to run.

════════════════════════════════════════════════════════════════════════
GUARDRAILS — MUST NOT
════════════════════════════════════════════════════════════════════════
  • DO NOT modify book_public_showing or accept_reschedule_proposal — the index relaxation is
    sufficient; their unique_violation handlers are the non-opted-org backstop.
  • DO NOT set slot_lock from application code — the trigger owns it.
  • DO NOT drop the unique index without recreating it (keyed on slot_lock, same partial
    predicate) in the SAME migration — never leave a window with no guard.
  • Non-opted orgs MUST be byte-identical to today (single booking; booked still populated).
  • Default allow_double_booking = false; enable NO org in the migration.
  • Codex writes the migration file(s); Cowork applies via Supabase MCP.

════════════════════════════════════════════════════════════════════════
DELIVERABLE
════════════════════════════════════════════════════════════════════════
A single diff touching exactly:
  NEW:  supabase/migrations/0159_allow_double_booking.sql   (flag + slot_lock + trigger + index swap + get_public_availability re-def)
  MOD:  app/dashboard/availability/actions.ts               (setAllowDoubleBooking)
  MOD:  app/dashboard/availability/page.tsx                 (the toggle)
  NEW:  scripts/test-*.ts                                   (mechanics/authz test)
No changes under book_public_showing / accept_reschedule_proposal. Project typechecks
(`npx tsc --noEmit`) + builds + lints.
