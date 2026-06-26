-- 0074_rent_increase_tracking
-- Persist the two inputs the rent-increase ENGINE already accepts but nothing
-- stores, plus the once-per-cycle idempotency stamp for the new proactive
-- reminder (app/api/cron/rent-increase — the "autopilot" half of the free
-- compliance wedge, S339). The calc core (lib/rent-increase.ts) + the pre-filled
-- N1 (lib/n1-render.ts) shipped S282/S284; this closes the two correctness gaps
-- and the scheduled nudge.
--
-- All columns are ADDITIVE + nullable/defaulted: no backfill, no behavior change
-- until populated. Until a row is set, deriveRentIncrease behaves exactly as
-- today (clock from start_date, guideline-capped). Mirrors the 0073 snapshot
-- pattern: columns on existing tables, no new table/function → no new advisor
-- class, and column privileges inherit the existing per-org RLS table grants.

-- ---------------------------------------------------------------------------
-- 1. tenancies — last-increase date + the reminder idempotency stamp.
-- ---------------------------------------------------------------------------
alter table public.tenancies
  -- Date of the most recent rent increase, if any (feeds
  -- deriveRentIncrease.lastIncreaseDate). NULL = no increase yet → the 12-month
  -- clock derives from start_date exactly as today. Set when an N1 is served /
  -- an increase is recorded; advancing it rolls the next eligible anniversary
  -- forward a year and naturally re-arms the nudge for the new cycle.
  add column if not exists last_rent_increase_date date,
  -- The earliest-effective (anniversary) date this tenancy was last nudged FOR.
  -- The cron pings every 15 min (shared GitHub Actions sweep); stamping the
  -- stable earliestEffectiveDate gates the reminder to exactly ONCE per increase
  -- cycle even as the realistic effective date slips day-by-day in the
  -- serve_late/overdue states. Resets implicitly once last_rent_increase_date
  -- advances the anniversary. See lib/rent-increase-sweep.ts.
  add column if not exists rent_increase_nudged_for date;

comment on column public.tenancies.last_rent_increase_date is
  'Date of the most recent rent increase (YYYY-MM-DD); feeds deriveRentIncrease.lastIncreaseDate. NULL = none yet (clock runs from start_date).';
comment on column public.tenancies.rent_increase_nudged_for is
  'Earliest-effective (anniversary) date this tenancy was last nudged for by app/api/cron/rent-increase; the once-per-cycle idempotency stamp.';

-- ---------------------------------------------------------------------------
-- 2. properties — the post-2018-11-15 rent-control exemption (a UNIT fact).
--    OWNER-ASSERTED, never auto-determined: the UI label makes the landlord
--    responsible for the classification. deriveRentIncrease already returns the
--    correct `exempt` status + note; this just stores the input so the card and
--    the cron stop implicitly treating every unit as guideline-capped.
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists rent_control_exempt boolean not null default false,
  -- Optional evidence the exemption is asserted from (the unit's first-occupancy
  -- date). Informational; the boolean above is what the engine reads.
  add column if not exists first_occupancy_date date;

comment on column public.properties.rent_control_exempt is
  'Owner-asserted: unit first occupied after 2018-11-15 and exempt from the Ontario guideline cap. Feeds deriveRentIncrease.exempt. Never auto-determined.';
comment on column public.properties.first_occupancy_date is
  'Optional first-occupancy date the rent_control_exempt flag is asserted from (evidence only; the boolean is authoritative for the engine).';
