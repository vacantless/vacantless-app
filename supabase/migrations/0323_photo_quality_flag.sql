-- S832c (Noam 2026-11-23): a photo that looks dark or blurry is flagged on the
-- rental's photo list (lib/photo-quality.ts). Null = looks fine or not checked.
alter table public.property_photos
  add column if not exists quality_flag text
    check (quality_flag is null or quality_flag in ('dark', 'blurry', 'dark_blurry'));
