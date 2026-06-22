-- ============================================================================
-- 0057_work_order_building_scope — expense scope: unit vs building (S310)
--
-- The gap this closes (the sink-vs-gardening case): a maintenance cost belongs
-- to exactly ONE level, but until now work_orders only modelled the UNIT level
-- (property_id). A sink repair in unit 22 is a unit cost — that works. But a
-- shared cost for the whole building (gardening, snow removal, roof, boiler,
-- common-area cleaning, the building water bill) had nowhere honest to live: it
-- either got mis-attached to one unit (silently distorting that unit's numbers)
-- or floated with property_id = null and showed up as "Unassigned". This matters
-- most for a whole-building owner (the Abbas / 50 Glenrose archetype) who wants
-- a building-level P&L with the per-unit breakdown nested under it.
--
-- The model (exactly one scope per expense):
--   1. Unit-scoped     — property_id set, building_key null. Its building is
--      DERIVED from the unit (properties.building_key) at rollup time, never
--      duplicated here so it can't drift.
--   2. Building-scoped  — property_id null, building_key set. A shared cost owned
--      by the whole building, never pushed onto a single unit.
--   3. Unscoped         — both null. Genuine overhead (software, mileage); rare,
--      bucketed separately.
--
-- Why building_key (text), not a first-class buildings table: the grouping
-- already exists. properties.building_key (0049) is a STORED GENERATED column =
-- the normalized street address with the unit/suite/# stripped, so every unit in
-- a building already shares one key. We reuse it as the building identity and do
-- NOT re-parent the property model — no buildings table, no building_id FK on
-- every property, no onboarding change, no new RLS surface. work_orders is
-- already per-org; adding a text column changes nothing about its security
-- model. (The one case building_key can't serve — a shared cost for a building
-- with ZERO units in the system — is the trigger to promote to a real buildings
-- table, and that trigger is the multi-building-owner ICP. Not now.)
--
-- building_key here is free text matching what public.building_key(address)
-- produces for the chosen building, so a building-scoped work order and the units
-- of that building share the same key and roll up together. No new table, no new
-- policy: the existing per-org work_orders RLS (0054) already covers this column.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. building_key — the building a SHARED cost belongs to. Null for unit-scoped
--    rows (they derive their building from the unit) and for unscoped rows.
-- ---------------------------------------------------------------------------
alter table public.work_orders
  add column if not exists building_key text;

comment on column public.work_orders.building_key is
  'Building identity for a building-scoped (shared) work order: matches public.building_key(address) for the building, so it rolls up with that building''s units (which share properties.building_key). Null for a unit-scoped row (building derived from the unit) and for an unscoped row. Enforced exactly-one-of with property_id by work_orders_scope_chk.';

-- ---------------------------------------------------------------------------
-- 2. Exactly-one-level CHECK: a work order is unit-scoped (property_id set) OR
--    building-scoped (building_key set) OR unscoped (both null) — never both.
--    DO block (no "add constraint if not exists") so the migration is re-runnable,
--    mirroring 0048/0049.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_orders_scope_chk') then
    alter table public.work_orders add constraint work_orders_scope_chk
      check (property_id is null or building_key is null);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Index the per-org building grouping (the statement's building rollup).
-- ---------------------------------------------------------------------------
create index if not exists work_orders_building_key_idx
  on public.work_orders(organization_id, building_key);
