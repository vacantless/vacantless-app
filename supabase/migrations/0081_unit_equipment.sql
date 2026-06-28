-- ============================================================================
-- 0081_unit_equipment — per-unit major-equipment inventory (S361)
--
-- The second per-unit ASSET RECORD in the app, the sibling of unit_detectors
-- (0080). A unit (a public.properties row) has its major mechanical equipment —
-- a water heater, a furnace (extensible later to AC, roof, etc.) — each with an
-- install date + a manufacturer service life. This is a child table keyed to the
-- property, NOT columns on properties.
--
-- It drives a per-unit, date-anchored landlord reminder (app/api/cron/equipment-
-- eol): each item's install date + service life => an end-of-life date; when an
-- item enters its (per-type) lead window the operator gets ONE email per unit so
-- they plan a business-hours / off-season replacement instead of reacting to a
-- failure. Anchored to each item's install date, this rides the rent-increase-
-- style per-record sweep (the WORKFLOW-118 primitive first shipped for detectors),
-- NOT the fixed seasonal compliance calendar.
--
-- Why one table with an equipment_type whitelist (not unit_water_heaters +
-- unit_furnaces): a water heater and a furnace share an identical shape (install
-- anchor + service life + EOL reminder) and differ only in their per-type default
-- service life and lead window (both live in code, lib/equipment-eol.ts). One
-- typed table keeps a single sweep + a single capture surface and lets a new
-- class (AC, roof) be a one-line CHECK change, never a new table. (Detectors made
-- the same call: smoke/co/combo in one unit_detectors table.)
--
-- Conventions mirror unit_detectors (0080) / work_orders (0054):
--   * organization_id is DENORMALIZED onto the row so RLS gates on
--     organization_id IN user_org_ids() with no join and the service-role cron
--     filters by org directly. on delete cascade with the property (the record
--     has no meaning once the unit is gone).
--   * equipment_type is free-ish text + a CHECK whitelist (NOT a pg enum), so a
--     new type is a one-line CHECK change, never an ALTER TYPE.
--   * explicit grants (auto-expose of new tables is OFF); service_role gets DML
--     so the reminder cron never hits the silent permission-denied trap.
--
-- All additive; ships inert (no rows until a landlord enters equipment), and the
-- reminder is opt-in per org (isDripEnqueueEnabled) on top, so it ships dark.
-- No tenant PII ever lands here — equipment facts only.
-- ============================================================================

create table if not exists public.unit_equipment (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  property_id      uuid not null references public.properties(id)    on delete cascade,

  -- water_heater = tank/tankless DHW heater; furnace = forced-air heating plant.
  -- Extensible: add 'ac', 'roof', etc. here + in lib/equipment-eol.ts defaults.
  equipment_type   text not null default 'water_heater'
                     check (equipment_type in ('water_heater', 'furnace')),
  -- free text: "Basement mechanical room", "Utility closet".
  location         text,

  -- Anchor for the end-of-life clock. install_date is preferred; install_year is
  -- the fallback for the common case where a landlord only knows the year (the
  -- pure EOL math treats a year as that year's start, so it warns early not late).
  install_date     date,
  install_year     integer
                     check (install_year is null
                            or (install_year between 1950 and 2100)),

  -- Owner override of the manufacturer service life. NULL = the per-type default
  -- applied in code (lib/equipment-eol.ts: water_heater 10 / furnace 15 years).
  -- Range allows a tankless heater (~20) or an electric furnace (~25).
  service_life_years integer
                     check (service_life_years is null
                            or (service_life_years between 1 and 40)),

  -- Convenience count of identical units at this spot (e.g. two furnaces serving
  -- one suite); the reminder reads it into the copy. Usually 1 for major gear.
  quantity         integer not null default 1
                     check (quantity >= 1),

  -- Idempotency stamp for the reminder sweep: the end-of-life date this item was
  -- last nudged FOR. Mirrors unit_detectors.eol_nudged_for /
  -- tenancies.rent_increase_nudged_for — stamping the STABLE EOL date gates the
  -- email to once per item lifecycle even while it sits in the overdue band.
  -- Logging a replacement (new install date => new EOL) makes the stamp mismatch
  -- and re-arms the next cycle. See lib/equipment-eol-sweep.ts.
  eol_nudged_for   date,

  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists unit_equipment_org_idx      on public.unit_equipment(organization_id);
create index if not exists unit_equipment_property_idx on public.unit_equipment(property_id);

comment on table public.unit_equipment is
  'Per-unit major-equipment inventory (S361): water heaters, furnaces. Feeds the per-unit end-of-life reminder (app/api/cron/equipment-eol) + the future Unit Bible / transfer dossier. Sibling of unit_detectors. No tenant PII.';
comment on column public.unit_equipment.eol_nudged_for is
  'End-of-life date this item was last nudged for by app/api/cron/equipment-eol; the once-per-lifecycle idempotency stamp (see lib/equipment-eol-sweep.ts).';
comment on column public.unit_equipment.service_life_years is
  'Owner override of manufacturer service life in years; NULL = per-type default in code (water_heater 10 / furnace 15).';

-- ---------------------------------------------------------------------------
-- RLS — per-org, identical shape to unit_detectors (0080) and work_orders (0054).
-- ---------------------------------------------------------------------------
alter table public.unit_equipment enable row level security;

drop policy if exists unit_equipment_all on public.unit_equipment;
create policy unit_equipment_all on public.unit_equipment
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard capture UI; service_role for the reminder sweep.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.unit_equipment to authenticated;
grant select, insert, update, delete on public.unit_equipment to service_role;
