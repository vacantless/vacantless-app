-- ============================================================================
-- 0094_tenancy_inspections — per-tenancy property inspection log + reminder (S385)
--
-- A landlord should run an inspection at key points in a tenancy: a move-in
-- condition report at the start, a move-out report at the end, and (optionally)
-- a periodic mid-lease check. These are the record that protects the deposit /
-- last-month's-rent dispute, documents wear-and-tear vs damage, and surfaces
-- maintenance early. Today there is nowhere in the app to schedule one or keep
-- the condition notes, so they live in scattered photos and memory.
--
-- This child table is the system of record for those inspections, and the
-- planned date (scheduled_for) drives a per-tenancy reminder
-- (app/api/cron/inspection-reminder) so a move-in/move-out/periodic inspection
-- doesn't get forgotten — the landlord still needs to give the tenant the
-- required written notice and book a time.
--
-- It is a TENANCY-scoped record, the sibling of tenancy_violations (0092) and
-- tenancy_insurance (0091): same per-record date-anchored reminder primitive
-- (WORKFLOW 118). Here the anchor is the scheduled_for date and the reminder
-- fires while the inspection is still 'scheduled' (marking it completed/skipped
-- silences it) — exactly the lifecycle-silences-the-nudge shape lease violations
-- use, with no install + service-life compute.
--
-- SCOPE: this SCHEDULES + LOGS inspections and reminds on the planned date. It
-- does NOT generate a formal condition-report form or capture tenant signatures
-- (a later slice). condition_notes is free text for the file.
--
-- PII posture: stores the landlord's own inspection facts — when, what kind, the
-- unit's condition. NO driver's licence / SIN / credit / NOA data ever lands
-- here, per the standing rule. (Mirrors tenancy_violations / incident_reports.)
--
-- Conventions mirror tenancy_violations (0092) / tenancy_insurance (0091):
--   * organization_id is DENORMALIZED onto the row so RLS gates on
--     organization_id IN user_org_ids() with no join and the service-role cron
--     filters by org directly. on delete cascade with the tenancy.
--   * explicit grants (auto-expose of new tables is OFF); service_role gets DML
--     so the reminder cron never hits the silent permission-denied trap.
--
-- All additive; ships inert (no rows until a landlord schedules an inspection),
-- and the reminder is opt-in per org (isDripEnqueueEnabled) on top, so it ships
-- dark.
-- ============================================================================

create table if not exists public.tenancy_inspections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  tenancy_id       uuid not null references public.tenancies(id)     on delete cascade,

  -- The kind of inspection. Constrained to a known set the UI offers as a
  -- select; 'other' is the catch-all (detail goes in notes).
  inspection_type  text not null default 'periodic'
                     check (inspection_type in (
                       'move_in', 'move_out', 'periodic', 'other'
                     )),

  -- When the inspection is planned for. This is the ANCHOR for the reminder: as
  -- it approaches / passes (while the record is still 'scheduled') the operator
  -- gets one nudge to give notice + book it.
  scheduled_for    date,

  -- Lifecycle of the inspection. 'scheduled' is the only state the reminder acts
  -- on; moving to completed/skipped/canceled stops the nudge.
  status           text not null default 'scheduled'
                     check (status in ('scheduled', 'completed', 'skipped', 'canceled')),

  -- When the inspection actually happened (set when marked completed).
  completed_on     date,

  -- The condition record / findings — the core of the log entry.
  condition_notes  text,

  -- Idempotency stamp for the reminder sweep: the scheduled_for this record was
  -- last nudged FOR. Mirrors tenancy_violations.followup_nudged_for — stamping
  -- the STABLE scheduled_for gates the email to once per planned date. Editing
  -- the date (or reopening to scheduled) clears the stamp and re-arms. See
  -- lib/property-inspections-sweep.ts.
  reminder_nudged_for date,

  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists tenancy_inspections_org_idx     on public.tenancy_inspections(organization_id);
create index if not exists tenancy_inspections_tenancy_idx on public.tenancy_inspections(tenancy_id);

comment on table public.tenancy_inspections is
  'Per-tenancy property inspection log (S385): inspection type (move-in/move-out/periodic), planned date, lifecycle, condition notes. Feeds the per-tenancy inspection reminder (app/api/cron/inspection-reminder). Tenancy-scoped sibling of tenancy_violations / tenancy_insurance. Logs the landlord''s own inspection facts only — no DL/SIN/credit PII; does NOT generate a condition-report form or capture tenant signatures.';
comment on column public.tenancy_inspections.scheduled_for is
  'Planned inspection date; the anchor for the reminder (fires as it approaches/passes while status=scheduled).';
comment on column public.tenancy_inspections.reminder_nudged_for is
  'scheduled_for this record was last nudged for by app/api/cron/inspection-reminder; the once-per-date idempotency stamp (see lib/property-inspections-sweep.ts).';

-- ---------------------------------------------------------------------------
-- RLS — per-org, identical shape to tenancy_violations (0092) / work_orders.
-- ---------------------------------------------------------------------------
alter table public.tenancy_inspections enable row level security;

drop policy if exists tenancy_inspections_all on public.tenancy_inspections;
create policy tenancy_inspections_all on public.tenancy_inspections
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard capture UI; service_role for the reminder sweep.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.tenancy_inspections to authenticated;
grant select, insert, update, delete on public.tenancy_inspections to service_role;
