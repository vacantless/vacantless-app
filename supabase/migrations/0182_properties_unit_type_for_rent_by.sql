-- ============================================================================
-- 0182_properties_unit_type_for_rent_by — close the S551 schema DRIFT.
--
-- properties.unit_type and properties.for_rent_by are read + written by the
-- property detail/edit surface (app/dashboard/properties/[id]/page.tsx,
-- app/dashboard/properties/actions.ts) and by the listing-copy helpers, but NO
-- migration ever added them: they were hot-applied directly to the prod DB. So
-- prod works, while any database rebuilt from migrations (a fresh clone, CI, a
-- staging project) lacks the columns and breaks the property pages on load/save.
-- This migration makes the schema match prod exactly, and is fully idempotent:
-- run against prod it is a no-op; run against a fresh DB it creates the columns
-- and their CHECKs. Definitions mirror prod verbatim
-- [verified 2026-07-25 via information_schema + pg_get_constraintdef]:
--   for_rent_by : text NOT NULL DEFAULT 'owner'  CHECK in ('owner','professional')
--   unit_type   : text NULL                      CHECK in
--                 ('apartment','condo','basement-apartment','house',
--                  'townhouse','duplex-triplex')
-- ============================================================================

alter table public.properties
  add column if not exists for_rent_by text not null default 'owner';

alter table public.properties
  add column if not exists unit_type text;

-- CHECKs guarded (Postgres has no ADD CONSTRAINT IF NOT EXISTS): create each only
-- when absent, so this is a no-op on prod where both already exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'properties_for_rent_by_check'
  ) then
    alter table public.properties
      add constraint properties_for_rent_by_check
      check (for_rent_by = any (array['owner'::text, 'professional'::text]));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'properties_unit_type_check'
  ) then
    alter table public.properties
      add constraint properties_unit_type_check
      check (unit_type = any (array[
        'apartment'::text, 'condo'::text, 'basement-apartment'::text,
        'house'::text, 'townhouse'::text, 'duplex-triplex'::text
      ]));
  end if;
end $$;
