-- ============================================================================
-- 0198_properties_structure_type
--
-- Per-property structure/mechanical-responsibility signal for compliance-calendar
-- eligibility. This is intentionally separate from properties.unit_type:
-- "apartment" can mean a freehold apartment-over-store the landlord owns, or a
-- rented highrise unit whose building mechanicals the landlord does not own.
--
-- Nullable and unbackfilled on purpose. Unknown structure does not qualify a
-- property for freehold-only reminders, which keeps the calendar quiet until an
-- operator has confirmed the structure.
-- ============================================================================

alter table public.properties
  add column if not exists structure_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'properties_structure_type_check'
  ) then
    alter table public.properties
      add constraint properties_structure_type_check
      check (
        structure_type is null
        or structure_type = any (array[
          'freehold'::text,
          'condo'::text,
          'rental_unit'::text
        ])
      );
  end if;
end $$;

comment on column public.properties.structure_type is
  'Nullable operator-confirmed structure/mechanical responsibility for compliance-calendar eligibility: freehold, condo, or rental_unit. Unknown stays null and does not qualify freehold-only reminders.';
