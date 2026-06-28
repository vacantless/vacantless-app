-- ============================================================================
-- 0080_unit_detectors — per-unit smoke / CO detector inventory (S359)
--
-- The first real per-unit ASSET RECORD in the app (until now the "Unit Bible"
-- was only a markdown template). A unit (a public.properties row) has MANY
-- detectors of different types/locations/ages, so this is a child table keyed to
-- the property — NOT columns on properties.
--
-- It drives a per-unit, date-anchored landlord reminder (app/api/cron/detector-
-- eol): each detector's install date + service life => an end-of-life date; when
-- a detector enters the lead window the operator gets one email per unit so they
-- buy the RIGHT type and combine the trip instead of reacting to a 3am beep.
-- Anchored to each detector's install date, this rides the rent-increase-style
-- per-record sweep, NOT the fixed seasonal compliance calendar.
--
-- Capture once, surface three places: the same rows feed (a) this reminder,
-- (b) the per-unit Unit Bible, and (c) the building-level transfer dossier
-- later. This migration builds the record + the reminder substrate only.
--
-- Conventions mirror the per-org child tables in 0001 / 0054 (work_orders):
--   * organization_id is DENORMALIZED onto the row (not just reachable via the
--     property) so RLS gates on organization_id IN user_org_ids() with no join
--     and the service-role cron filters by org directly — same shape as every
--     other per-org table. on delete cascade with the property (a detector has
--     no meaning once the unit is gone — unlike a work order's cost history).
--   * status / type are free-ish text + CHECK whitelist (NOT a pg enum), so a
--     new type is a one-line CHECK change, never an ALTER TYPE.
--   * explicit grants (auto-expose of new tables is OFF); service_role gets DML
--     so the reminder cron never hits the silent permission-denied trap.
--
-- All additive; ships inert (no rows until a landlord enters detectors), and the
-- reminder is opt-in per org (isDripEnqueueEnabled) on top, so it ships dark.
-- No tenant PII ever lands here — detector facts only.
-- ============================================================================

create table if not exists public.unit_detectors (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  property_id      uuid not null references public.properties(id)    on delete cascade,

  -- combo = combined smoke + carbon-monoxide; co = CO-only; smoke = smoke-only.
  detector_type    text not null default 'combo'
                     check (detector_type in ('smoke', 'co', 'combo')),
  -- free text: "Basement hallway", "Upper bedroom", "Furnace room".
  location         text,

  -- Anchor for the end-of-life clock. install_date is preferred; install_year is
  -- the fallback for the common case where a landlord only knows the year (the
  -- pure EOL math treats a year as that year's start, so it warns early not late).
  install_date     date,
  install_year     integer
                     check (install_year is null
                            or (install_year between 1980 and 2100)),

  -- Owner override of the manufacturer service life. NULL = the per-type default
  -- applied in code (lib/detector-eol.ts: smoke 10 / co 7 / combo 10 years).
  service_life_years integer
                     check (service_life_years is null
                            or (service_life_years between 1 and 30)),

  -- Convenience count of identical detectors at this spot (so one row can stand
  -- for "3 combos on this floor"); the reminder reads it into the copy.
  quantity         integer not null default 1
                     check (quantity >= 1),

  -- Idempotency stamp for the reminder sweep: the end-of-life date this detector
  -- was last nudged FOR. Mirrors tenancies.rent_increase_nudged_for — stamping
  -- the STABLE EOL date gates the email to once per detector lifecycle even
  -- while it sits in the overdue band. Logging a replacement (new install date
  -- => new EOL) makes the stamp mismatch and re-arms the next cycle. See
  -- lib/detector-eol-sweep.ts.
  eol_nudged_for   date,

  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists unit_detectors_org_idx      on public.unit_detectors(organization_id);
create index if not exists unit_detectors_property_idx on public.unit_detectors(property_id);

comment on table public.unit_detectors is
  'Per-unit smoke/CO detector inventory (S359). Feeds the per-unit end-of-life reminder (app/api/cron/detector-eol) + the future Unit Bible / transfer dossier. No tenant PII.';
comment on column public.unit_detectors.eol_nudged_for is
  'End-of-life date this detector was last nudged for by app/api/cron/detector-eol; the once-per-lifecycle idempotency stamp (see lib/detector-eol-sweep.ts).';
comment on column public.unit_detectors.service_life_years is
  'Owner override of manufacturer service life in years; NULL = per-type default in code (smoke 10 / co 7 / combo 10).';

-- ---------------------------------------------------------------------------
-- RLS — per-org, identical shape to work_orders (0054) and the 0001 tables.
-- ---------------------------------------------------------------------------
alter table public.unit_detectors enable row level security;

drop policy if exists unit_detectors_all on public.unit_detectors;
create policy unit_detectors_all on public.unit_detectors
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard capture UI; service_role for the reminder sweep.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.unit_detectors to authenticated;
grant select, insert, update, delete on public.unit_detectors to service_role;
