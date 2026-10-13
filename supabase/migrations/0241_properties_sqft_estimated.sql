-- S712 (Noam, 2026-10-13): when a rental has no size, Vacantless fills an
-- estimate (same building and bedrooms, else the org's own rentals, else a
-- general default) so Kijiji and Zumper are not held for square footage.
-- This flag marks that the size is an estimate, so the edit form says so and a
-- real number typed by the landlord replaces it. Existing rows stay false.
alter table public.properties
  add column if not exists sqft_estimated boolean not null default false;
