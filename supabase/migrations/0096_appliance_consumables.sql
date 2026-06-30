-- ============================================================================
-- 0096_appliance_consumables — multiple recurring consumables per appliance (S389)
--
-- The S362 appliance inventory (0082_unit_appliances) carried exactly ONE
-- recurring consumable per appliance, as four columns on the appliance row
-- (consumable_label / consumable_interval_months / consumable_anchor_date /
-- consumable_nudged_for). A real appliance has several — a fridge has a water
-- filter (~6mo) AND an air filter (~12mo); a range hood has a charcoal filter; a
-- dryer has a lint-vent clean-out. One embedded slot can't model that.
--
-- This promotes the recurring consumable to its OWN child table, a grandchild of
-- properties: properties -> unit_appliances -> appliance_consumables. The
-- WARRANTY reminder is genuinely one-per-appliance (one manufacturer warranty),
-- so it STAYS on unit_appliances unchanged; only the recurring consumable moves.
--
-- The recurring-consumable reminder (app/api/cron/appliance-care, the CONSUMABLE
-- kind) now iterates these child rows instead of the appliance row: next due =
-- anchor_date (or the appliance's purchase anchor) + interval_months; a one-tap
-- "Mark replaced" rolls anchor_date to today, advancing the schedule one cycle.
-- See lib/appliance-care.ts (consumableNextDue) + lib/appliance-care-sweep.ts.
--
-- Conventions mirror unit_appliances (0082) / unit_equipment (0081):
--   * organization_id is DENORMALIZED onto the row so RLS gates on
--     organization_id IN user_org_ids() with no join and the service-role cron
--     filters by org directly.
--   * property_id is DENORMALIZED too so the cron groups reminders by unit
--     without a join (an appliance never moves to another unit).
--   * appliance_id cascades, so removing an appliance removes its consumables.
--   * explicit grants (auto-expose of new tables is OFF); service_role gets DML
--     so the reminder cron never hits the silent permission-denied trap.
--
-- All additive then a clean column drop: this migration backfills any pre-existing
-- embedded consumable into a child row FIRST, then drops the now-redundant
-- consumable_* columns from unit_appliances so there is a single source of truth
-- and no dead columns. unit_appliances is empty across all orgs at apply time
-- (verified: select count(*) = 0), so the backfill is a correct no-op and the drop
-- loses nothing. No tenant PII ever lands here — consumable facts only.
-- ============================================================================

create table if not exists public.appliance_consumables (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id)   on delete cascade,
  property_id      uuid not null references public.properties(id)       on delete cascade,
  appliance_id     uuid not null references public.unit_appliances(id)  on delete cascade,

  -- A short label for the recurring consumable, e.g. "Water filter",
  -- "Air filter", "Range-hood charcoal filter", "Lint vent".
  label            text not null,
  -- The replacement interval in MONTHS (e.g. 6 or 12). Cap 120 = 10 years.
  interval_months  integer not null
                     check (interval_months between 1 and 120),
  -- The date this consumable was LAST replaced (or first installed). NULL =>
  -- fall back to the appliance's purchase anchor in code. Next due =
  -- this + interval_months; a one-tap "Mark replaced" sets this to today,
  -- advancing the whole schedule one cycle. THIS is the recurrence.
  anchor_date      date,
  -- Idempotency stamp: the specific occurrence (next-due) date last nudged FOR.
  -- Stable until the consumable is marked replaced (which rolls anchor_date => a
  -- new next-due => the stamp no longer matches => the next cycle re-arms).
  -- See lib/appliance-care-sweep.ts.
  nudged_for       date,

  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists appliance_consumables_org_idx       on public.appliance_consumables(organization_id);
create index if not exists appliance_consumables_property_idx  on public.appliance_consumables(property_id);
create index if not exists appliance_consumables_appliance_idx on public.appliance_consumables(appliance_id);

comment on table public.appliance_consumables is
  'Per-appliance recurring consumables (S389): a fridge water filter, an air filter, a range-hood charcoal filter, a dryer lint vent. Grandchild of properties (via unit_appliances). Drives the recurring half of the appliance-care reminder (app/api/cron/appliance-care, the CONSUMABLE kind). Replaces the single embedded consumable_* slot on unit_appliances. No tenant PII.';
comment on column public.appliance_consumables.anchor_date is
  'Date this consumable was last replaced (or first installed); NULL => the appliance purchase anchor in code. Next due = this + interval_months. A one-tap mark-replaced rolls it to today.';
comment on column public.appliance_consumables.nudged_for is
  'Next-due occurrence date this consumable was last nudged for; the idempotency stamp that re-arms when the consumable is marked replaced (see lib/appliance-care-sweep.ts).';

-- ---------------------------------------------------------------------------
-- RLS — per-org, identical shape to unit_appliances (0082).
-- ---------------------------------------------------------------------------
alter table public.appliance_consumables enable row level security;

drop policy if exists appliance_consumables_all on public.appliance_consumables;
create policy appliance_consumables_all on public.appliance_consumables
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard capture UI; service_role for the reminder sweep.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.appliance_consumables to authenticated;
grant select, insert, update, delete on public.appliance_consumables to service_role;

-- ---------------------------------------------------------------------------
-- Backfill: move any pre-existing embedded consumable into a child row. A
-- correct no-op when unit_appliances is empty (it is, at apply time). A row
-- qualifies when it has a non-blank label AND an interval.
-- ---------------------------------------------------------------------------
insert into public.appliance_consumables
  (organization_id, property_id, appliance_id, label, interval_months, anchor_date, nudged_for)
select
  a.organization_id,
  a.property_id,
  a.id,
  btrim(a.consumable_label),
  a.consumable_interval_months,
  a.consumable_anchor_date,
  a.consumable_nudged_for
from public.unit_appliances a
where a.consumable_label is not null
  and btrim(a.consumable_label) <> ''
  and a.consumable_interval_months is not null;

-- ---------------------------------------------------------------------------
-- Drop the now-redundant embedded consumable columns from unit_appliances —
-- appliance_consumables is the single source of truth. (Dropping a column drops
-- its comment automatically.) warranty_* stays: one warranty per appliance.
-- ---------------------------------------------------------------------------
alter table public.unit_appliances
  drop column if exists consumable_label,
  drop column if exists consumable_interval_months,
  drop column if exists consumable_anchor_date,
  drop column if exists consumable_nudged_for;
