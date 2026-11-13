-- ============================================================================
-- Vacantless - S789b: a rental's photo folder, and where each photo came from.
-- ============================================================================
-- properties.photo_source_url: the shared folder the unit's photos are kept
-- in (Google Drive pulls in automatically; any other link is kept so the
-- landlord can open it). Set by the landlord on the rental page or by the
-- crew with their "Photos are in" tap.
-- property_photos.source_ref: "gdrive:<file id>" for a photo pulled from a
-- Drive folder, so pulling again adds only new photos. Null for uploads.
-- ============================================================================

alter table public.properties
  add column if not exists photo_source_url text
    check (photo_source_url is null or (length(photo_source_url) <= 1000 and photo_source_url like 'https://%'));

alter table public.property_photos
  add column if not exists source_ref text
    check (source_ref is null or length(source_ref) <= 200);

create unique index if not exists property_photos_source_ref_uq
  on public.property_photos (property_id, source_ref)
  where source_ref is not null;
