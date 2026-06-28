-- ============================================================================
-- 0082_unit_appliances — per-unit appliance inventory (S362)
--
-- The THIRD per-unit ASSET RECORD in the app, the sibling of unit_detectors
-- (0080) and unit_equipment (0081). A unit (a public.properties row) has its
-- appliances — fridge, stove, dishwasher, washer, dryer, microwave — each a
-- durable good the landlord bought, that carries (a) a manufacturer warranty and
-- (b), for some, a recurring consumable (a fridge water filter every ~6-12 months).
-- This is a child table keyed to the property, NOT columns on properties.
--
-- It drives TWO per-unit, date-anchored landlord reminders (app/api/cron/
-- appliance-care):
--   * WARRANTY (one-shot, like detector/equipment end-of-life): purchase date +
--     warranty length => an expiry date; when it enters a lead window the operator
--     gets ONE email per unit so they register/use the warranty before it lapses.
--   * CONSUMABLE (RECURRING — the genuinely new primitive): a labelled consumable
--     (e.g. "Water filter") with an interval in months, anchored to the last time
--     it was replaced (consumable_anchor_date, defaulting to the purchase date).
--     When the next due date enters its lead window the operator is reminded; a
--     one-tap "Mark replaced" rolls consumable_anchor_date to today, advancing the
--     whole schedule one cycle. This is the recurrence the once-per-lifecycle
--     detector/equipment sweep does NOT cover — see lib/appliance-care.ts.
--
-- Why ONE typed table with an appliance_type whitelist (not unit_fridges +
-- unit_stoves): every appliance shares an identical shape (make/model/serial +
-- warranty + an optional recurring consumable) and differs only in defaults that
-- live in code. One typed table keeps a single capture surface + a single sweep
-- and makes a new class a one-line CHECK change, never a new table. Detectors
-- (smoke/co/combo) and equipment (water_heater/furnace) made the same call.
--
-- Conventions mirror unit_equipment (0081) / unit_detectors (0080):
--   * organization_id is DENORMALIZED onto the row so RLS gates on
--     organization_id IN user_org_ids() with no join and the service-role cron
--     filters by org directly. on delete cascade with the property.
--   * appliance_type is text + a CHECK whitelist (NOT a pg enum), so a new type
--     is a one-line CHECK change, never an ALTER TYPE.
--   * explicit grants (auto-expose of new tables is OFF); service_role gets DML
--     so the reminder cron never hits the silent permission-denied trap.
--
-- All additive; ships inert (no rows until a landlord enters an appliance), and
-- each reminder is opt-in per org (isDripEnqueueEnabled) on top, so it ships dark.
-- No tenant PII ever lands here — appliance facts only (make/model/serial are the
-- manufacturer's, not a person's). The purchase RECEIPT is a later slice: a
-- documents-vault row linked back to the appliance (deferred from this migration).
-- ============================================================================

create table if not exists public.unit_appliances (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  property_id      uuid not null references public.properties(id)    on delete cascade,

  -- Extensible: add 'freezer', 'range_hood', etc. here + (optionally) a default
  -- in lib/appliance-care.ts. 'other' is the catch-all so nothing is unloggable.
  appliance_type   text not null default 'fridge'
                     check (appliance_type in (
                       'fridge', 'stove', 'dishwasher', 'washer', 'dryer',
                       'microwave', 'other'
                     )),
  -- Manufacturer identity — the data you need to claim a warranty or order the
  -- right part later. These are the appliance's, never a person's: no tenant PII.
  make             text,
  model            text,
  serial           text,
  -- free text: "Kitchen", "Basement laundry".
  location         text,

  -- Anchor for both clocks. purchase_date is preferred; install_year is the
  -- fallback for the common case where only the year is known (the pure math
  -- treats a bare year as that year's start, so it warns early, never late).
  purchase_date    date,
  install_year     integer
                     check (install_year is null
                            or (install_year between 1950 and 2100)),

  -- Convenience count of identical units (e.g. two identical bar fridges); the
  -- reminder reads it into the copy. Usually 1.
  quantity         integer not null default 1
                     check (quantity >= 1),

  -- --- Warranty (one-shot reminder) ----------------------------------------
  -- Length of the manufacturer warranty in MONTHS from the purchase anchor.
  -- NULL = no warranty tracked (no reminder). Cap 600 = 50 years (lifetime).
  warranty_months  integer
                     check (warranty_months is null
                            or (warranty_months between 1 and 600)),
  -- Idempotency stamp for the warranty reminder: the warranty-expiry date this
  -- appliance was last nudged FOR. Stamping the STABLE expiry date gates the
  -- email to once per appliance lifecycle. Logging a new purchase date rolls the
  -- expiry and re-arms. Mirrors unit_equipment.eol_nudged_for.
  warranty_nudged_for date,

  -- --- Consumable (RECURRING reminder) --------------------------------------
  -- A short label for the recurring consumable, e.g. "Water filter",
  -- "Lint filter", "Range hood filter". NULL/blank = no recurring reminder.
  consumable_label text,
  -- The replacement interval in MONTHS (e.g. 6 or 12). Required (with a label)
  -- for the recurring reminder to fire. Cap 120 = 10 years.
  consumable_interval_months integer
                     check (consumable_interval_months is null
                            or (consumable_interval_months between 1 and 120)),
  -- The date the consumable was LAST replaced (or first installed). NULL =>
  -- fall back to the purchase anchor in code. The recurring "next due" =
  -- this + interval; a one-tap "Mark replaced" sets this to today, advancing the
  -- whole schedule one cycle. THIS is what makes the reminder recurring.
  consumable_anchor_date date,
  -- Idempotency stamp for the recurring reminder: the specific occurrence (next-
  -- due) date last nudged FOR. Stable until the appliance is marked replaced
  -- (which rolls consumable_anchor_date => a new next-due => the stamp no longer
  -- matches => the next cycle re-arms). See lib/appliance-care-sweep.ts.
  consumable_nudged_for date,

  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists unit_appliances_org_idx      on public.unit_appliances(organization_id);
create index if not exists unit_appliances_property_idx on public.unit_appliances(property_id);

comment on table public.unit_appliances is
  'Per-unit appliance inventory (S362): fridge/stove/dishwasher/washer/dryer/microwave. Feeds two per-unit reminders (warranty one-shot + recurring consumable; app/api/cron/appliance-care) + the future Unit Bible / transfer dossier. Sibling of unit_equipment / unit_detectors. No tenant PII.';
comment on column public.unit_appliances.warranty_nudged_for is
  'Warranty-expiry date this appliance was last nudged for; the once-per-lifecycle idempotency stamp (see lib/appliance-care-sweep.ts).';
comment on column public.unit_appliances.consumable_anchor_date is
  'Date the recurring consumable was last replaced (or first installed); NULL => purchase anchor in code. Next due = this + consumable_interval_months. A one-tap mark-replaced rolls it to today.';
comment on column public.unit_appliances.consumable_nudged_for is
  'Next-due occurrence date the recurring consumable was last nudged for; the idempotency stamp that re-arms when the appliance is marked replaced (see lib/appliance-care-sweep.ts).';

-- ---------------------------------------------------------------------------
-- RLS — per-org, identical shape to unit_equipment (0081) / unit_detectors (0080).
-- ---------------------------------------------------------------------------
alter table public.unit_appliances enable row level security;

drop policy if exists unit_appliances_all on public.unit_appliances;
create policy unit_appliances_all on public.unit_appliances
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard capture UI; service_role for the reminder sweep.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.unit_appliances to authenticated;
grant select, insert, update, delete on public.unit_appliances to service_role;
