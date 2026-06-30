-- ============================================================================
-- 0095_work_order_appointments — repair-scheduling matcher (S386, Slice 2)
--
-- A repair visit has TWO timing constraints: the supplier offers fixed ARRIVAL
-- windows (e.g. Enercare 8-12 / 1-4 / 5-9, which vary day to day) AND the tenant
-- has their own availability. Today the operator is the human go-between. This
-- table is the per-work-order scheduling record that holds BOTH sides' windows
-- so the matcher (lib/repair-scheduling.ts) can surface where they line up and
-- the operator can confirm one agreed appointment.
--
-- ONE appointment row per work order (unique work_order_id). The two window sets
-- are JSONB arrays of { date, start_minute, end_minute, label? } (the DayWindow
-- shape from lib/repair-scheduling); validated/normalized in the server action,
-- never trusted raw. The chosen_* columns are the confirmed appointment (a date
-- + a time-of-day window — the first time-of-day appointment instant in the app;
-- work_orders.scheduled_for and expected_start/finish are date-only).
--
-- Also adds trade_contacts.supplier_window_rules: a supplier's REMEMBERED
-- preferred booking rules (Noam, S386) as JSONB [{ weekday|null, start_minute,
-- end_minute, label? }] — a saved DEFAULT the operator expands onto a job's
-- dates then edits, understanding the real blocks change. weekday is 0..6
-- (Sun-Sat, weekends first-class) or null = applies every day.
--
-- SCOPE: collects both sides' windows, records the chosen appointment, and
-- carries the reminder stamps (Slice 4). It does NOT book into the supplier's
-- system (the operator enters the offered windows) and moves no money. The
-- tenant_access_token + token_expires_at are provisioned here for the Slice 3
-- self-serve tenant pick-your-times page; until then the operator enters the
-- tenant's availability directly.
--
-- PII posture: stores scheduling facts only (dates + minute windows). No DL /
-- SIN / credit data. The tenant's identity already lives in the tenancy model.
--
-- Conventions mirror tenancy_violations (0092) / work_orders (0054):
--   * organization_id DENORMALIZED so RLS gates on user_org_ids() with no join
--     and the reminder cron filters by org directly. Cascade with the org.
--   * cascade with the work order (no appointment without its job); dispatch_id
--     is set-null (a dispatch can be re-created without losing the schedule).
--   * explicit grants (auto-expose of new tables is OFF); service_role gets DML
--     so the Slice 4 reminder sweep never hits the silent permission-denied trap.
--
-- All additive; ships inert (no rows until an operator opens scheduling on a
-- job), and the reminder is opt-in per org on top, so it ships dark.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- trade_contacts: remembered per-supplier preferred booking rules.
-- ---------------------------------------------------------------------------
alter table public.trade_contacts
  add column if not exists supplier_window_rules jsonb not null default '[]'::jsonb;

comment on column public.trade_contacts.supplier_window_rules is
  'Remembered preferred booking rules for this supplier (S386): JSONB [{weekday(0..6 or null=any day), start_minute, end_minute, label?}]. A saved DEFAULT the operator expands onto a job''s dates then edits per job (real blocks vary). See lib/repair-scheduling.ts expandRulesToDates.';

-- ---------------------------------------------------------------------------
-- work_order_appointments — the per-job scheduling record.
-- ---------------------------------------------------------------------------
create table if not exists public.work_order_appointments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- one appointment per job; cascade so deleting the job removes its schedule.
  work_order_id    uuid not null references public.work_orders(id) on delete cascade,
  -- optional link to the trade dispatch this appointment coordinates; set-null
  -- so a re-dispatch doesn't erase the agreed schedule.
  dispatch_id      uuid references public.work_order_dispatches(id) on delete set null,

  -- The two window sets, each a JSONB array of DayWindow
  -- ({ date:'YYYY-MM-DD', start_minute, end_minute, label? }). Validated +
  -- normalized in the server action; the DB only guarantees they are arrays.
  supplier_windows    jsonb not null default '[]'::jsonb,
  tenant_availability jsonb not null default '[]'::jsonb,

  -- The confirmed appointment: a date + a time-of-day window. All-or-nothing —
  -- a date requires a well-formed minute window.
  chosen_date         date,
  chosen_start_minute integer,
  chosen_end_minute   integer,

  -- Lifecycle of the scheduling record.
  status           text not null default 'collecting'
                     check (status in ('collecting', 'proposed', 'confirmed', 'cancelled')),

  -- Slice 3 self-serve tenant pick-your-times link credential (provisioned later).
  tenant_access_token text,
  token_expires_at    timestamptz,

  -- Slice 4 appointment reminders: 1-day-prior + same-day-prior, email + SMS on
  -- separate stamp columns (mirrors the showings reminder cron) so each channel
  -- sends — and never double-sends — on its own track.
  reminder_1d_sent_at        timestamptz,
  reminder_sameday_sent_at   timestamptz,
  reminder_1d_sms_sent_at    timestamptz,
  reminder_sameday_sms_sent_at timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint work_order_appointments_supplier_arr_chk
    check (jsonb_typeof(supplier_windows) = 'array'),
  constraint work_order_appointments_tenant_arr_chk
    check (jsonb_typeof(tenant_availability) = 'array'),
  -- chosen_* is all-or-nothing + a valid minute window.
  constraint work_order_appointments_chosen_chk
    check (
      chosen_date is null
      or (
        chosen_start_minute is not null
        and chosen_end_minute is not null
        and chosen_start_minute >= 0
        and chosen_end_minute <= 1440
        and chosen_start_minute < chosen_end_minute
      )
    )
);

-- One scheduling record per work order.
create unique index if not exists uq_work_order_appointments_wo
  on public.work_order_appointments(work_order_id);
create index if not exists work_order_appointments_org_idx
  on public.work_order_appointments(organization_id);
-- The token is the only lookup key in the Slice 3 public picker — globally unique.
create unique index if not exists uq_work_order_appointments_token
  on public.work_order_appointments(tenant_access_token)
  where tenant_access_token is not null;

comment on table public.work_order_appointments is
  'Per-work-order repair-scheduling record (S386): supplier-offered windows + tenant availability (JSONB DayWindow arrays) reconciled by lib/repair-scheduling.ts, plus the chosen date + time-of-day window and the Slice 4 appointment-reminder stamps. The operator enters the supplier''s offered windows (we never book the supplier''s system); scheduling facts only, no PII.';

-- ---------------------------------------------------------------------------
-- RLS — per-org, identical shape to work_orders (0054) / tenancy_violations.
-- ---------------------------------------------------------------------------
alter table public.work_order_appointments enable row level security;

drop policy if exists work_order_appointments_all on public.work_order_appointments;
create policy work_order_appointments_all on public.work_order_appointments
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard; service_role for the Slice 4 reminder sweep.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.work_order_appointments to authenticated;
grant select, insert, update, delete on public.work_order_appointments to service_role;
