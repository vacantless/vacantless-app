-- ============================================================================
-- Vacantless - S789e: automatic photo touch-up keeps the original.
-- ============================================================================
-- A crew photo pulled from the unit's folder is touched up (levels,
-- brightness, light sharpen). The rental shows the touched-up copy; the
-- original stays in storage so the landlord can switch back ("Use the
-- originals") and forth. touched_up says which one url/storage_path hold now.
-- ============================================================================
alter table public.property_photos
  add column if not exists original_storage_path text,
  add column if not exists original_url text,
  add column if not exists touched_up boolean not null default false;
