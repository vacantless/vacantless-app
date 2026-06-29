-- ============================================================================
-- 0092_tenancy_violations — per-tenancy lease violation / notice log (S383)
--
-- A landlord needs a durable record of lease breaches and the notices they
-- served (verbal/written warning, or a formal LTB notice like N5/N7/N8). Today
-- there is nowhere in the app to log "the tenant did X on this date, I gave them
-- until Y to fix it" — so the breach history that an N-form (and ultimately an
-- LTB application) depends on lives in scattered emails. This child table is the
-- system of record for that history, and an optional remedy-deadline drives a
-- per-tenancy follow-up reminder (app/api/cron/violation-followup) so the
-- deadline to verify-and-close-or-escalate doesn't slip.
--
-- It is a TENANCY-scoped record, the sibling of tenancy_insurance (0091): same
-- per-record date-anchored reminder primitive (WORKFLOW 118), here the anchor is
-- the optional remedy_due_on date (no install + service-life compute), and the
-- record hangs off the tenancy, not the property.
--
-- SCOPE: this LOGS violations + notices and reminds on remedy deadlines. It does
-- NOT generate or serve formal LTB forms — that is the gated served-notice slice
-- (legal/ToS pass). notice_type here is just free-text describing what was
-- served, for the file.
--
-- PII posture: stores the landlord's own incident facts — what happened, when,
-- what notice was given. NO driver's licence / SIN / credit / NOA data ever
-- lands here, per the standing rule. (Mirrors incident_reports / work_orders.)
--
-- Conventions mirror tenancy_insurance (0091) / unit_equipment (0081):
--   * organization_id is DENORMALIZED onto the row so RLS gates on
--     organization_id IN user_org_ids() with no join and the service-role cron
--     filters by org directly. on delete cascade with the tenancy.
--   * explicit grants (auto-expose of new tables is OFF); service_role gets DML
--     so the reminder cron never hits the silent permission-denied trap.
--
-- All additive; ships inert (no rows until a landlord logs a violation), and the
-- reminder is opt-in per org (isDripEnqueueEnabled) on top, so it ships dark.
-- ============================================================================

create table if not exists public.tenancy_violations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  tenancy_id       uuid not null references public.tenancies(id)     on delete cascade,

  -- The kind of breach. Constrained to a known set the UI offers as a select;
  -- 'other' is the catch-all (detail goes in description).
  violation_type   text not null default 'other'
                     check (violation_type in (
                       'late_rent', 'noise', 'property_damage',
                       'unauthorized_occupant', 'smoking', 'pet',
                       'cleanliness', 'safety', 'illegal_activity', 'other'
                     )),

  -- When the breach happened / was observed (informational; optional).
  occurred_on      date,
  -- What happened — the core of the log entry.
  description      text,

  -- What notice (if any) was given. FREE TEXT for the file: "Verbal warning",
  -- "Written warning", "N5", "N7". This is a record of what was served, NOT a
  -- generated/served form (that's the gated slice).
  notice_type      text,
  notice_served_on date,

  -- Optional remedy deadline given to the tenant. This is the ANCHOR for the
  -- follow-up reminder: as it approaches / passes (while the record is still
  -- open) the operator gets one nudge to verify-and-close-or-escalate.
  remedy_due_on    date,

  -- Lifecycle of the breach. 'open' is the only state the reminder acts on;
  -- moving to remedied/escalated/closed stops the nudge.
  status           text not null default 'open'
                     check (status in ('open', 'remedied', 'escalated', 'closed')),
  resolved_on      date,

  -- Idempotency stamp for the reminder sweep: the remedy_due_on this record was
  -- last nudged FOR. Mirrors tenancy_insurance.lapse_nudged_for — stamping the
  -- STABLE remedy_due_on gates the email to once per deadline. Editing the
  -- deadline (or reopening) clears the stamp and re-arms. See
  -- lib/lease-violations-sweep.ts.
  followup_nudged_for date,

  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists tenancy_violations_org_idx     on public.tenancy_violations(organization_id);
create index if not exists tenancy_violations_tenancy_idx on public.tenancy_violations(tenancy_id);

comment on table public.tenancy_violations is
  'Per-tenancy lease violation / notice log (S383): breach type, what happened, notice served, optional remedy deadline + lifecycle. Feeds the per-tenancy follow-up reminder (app/api/cron/violation-followup). Tenancy-scoped sibling of tenancy_insurance. Logs the landlord''s own incident facts only — no DL/SIN/credit PII; does NOT generate/serve LTB forms.';
comment on column public.tenancy_violations.remedy_due_on is
  'Optional remedy deadline; the anchor for the follow-up reminder (fires as it approaches/passes while status=open).';
comment on column public.tenancy_violations.followup_nudged_for is
  'remedy_due_on this record was last nudged for by app/api/cron/violation-followup; the once-per-deadline idempotency stamp (see lib/lease-violations-sweep.ts).';

-- ---------------------------------------------------------------------------
-- RLS — per-org, identical shape to tenancy_insurance (0091) / work_orders.
-- ---------------------------------------------------------------------------
alter table public.tenancy_violations enable row level security;

drop policy if exists tenancy_violations_all on public.tenancy_violations;
create policy tenancy_violations_all on public.tenancy_violations
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard capture UI; service_role for the reminder sweep.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.tenancy_violations to authenticated;
grant select, insert, update, delete on public.tenancy_violations to service_role;
