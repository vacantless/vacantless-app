-- S712 (Noam, 2026-10-13): a landlord marks a photo as a BUILDING photo
-- (outside, lobby, laundry). Every unit in the same building that has no
-- photos of its own gets a copy, so it can post with a real picture of the
-- building. Copies point at the same stored file (copied_from = the original
-- row); the landlord can delete or replace them per unit. Inside photos of one
-- unit are never used for another.
alter table public.property_photos
  add column if not exists building_photo boolean not null default false,
  add column if not exists copied_from uuid references public.property_photos(id) on delete set null;
create index if not exists idx_property_photos_building
  on public.property_photos(organization_id) where building_photo;
