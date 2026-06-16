-- ============================================================================
-- 0025_storage_select_policies — fix the silent photo/logo DELETE orphan (B4)
--
-- ROOT CAUSE (diagnosed S203):
--   0019 (property-photos) and 0020 (org-logos) added INSERT/UPDATE/DELETE
--   policies on storage.objects but NO SELECT policy, on the assumption that
--   "read is open because the bucket is public." That is true for the PUBLIC
--   CDN path (anon, served via storage.get_public_listing-style public reads),
--   but it is NOT true for an authenticated user's SQL access to the table.
--
--   `supabase.storage....remove([path])` and `.list(prefix)` run as the
--   signed-in user (role `authenticated`) against storage.objects. In Postgres,
--   a DELETE ... WHERE (and a LIST/SELECT) must first READ the target row, and
--   with RLS enabled + no SELECT policy the row is INVISIBLE to that role. So:
--     * deletePhoto's remove() matched 0 rows -> Storage API returned HTTP 200
--       with an empty deleted-list and NO error -> the storage object was
--       orphaned while the property_photos row was (correctly) deleted.
--     * clearOrgLogoFolder's .list() returned empty -> logo replace/remove left
--       the old object orphaned too.
--   (The storage.protect_delete trigger was a red herring; storage-api sets the
--    storage.allow_delete_query GUC, so the trigger is satisfied. Verified live:
--    with a SELECT policy present the authenticated delete affects 1 row;
--    without it, 0 rows.)
--
-- FIX:
--   Add a least-privilege SELECT policy on storage.objects for `authenticated`,
--   scoped to the caller's OWN org folder (first path segment = org id), for
--   both buckets. This makes remove()/list() see the row so the underlying
--   object is actually deleted via the Storage API (which frees the S3 blob).
--   Public CDN reads are unaffected (they don't go through this role/policy).
--   Mirrors the existing *_delete policy predicates exactly.
-- ============================================================================

-- property-photos: let an authenticated user SEE objects under their org folder
-- (required for remove() to locate the row to delete).
drop policy if exists "property_photos_select" on storage.objects;
create policy "property_photos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'property-photos'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

-- org-logos: same, so clearOrgLogoFolder's .list() + .remove() work and logo
-- replace/remove no longer orphans the old object.
drop policy if exists "org_logos_select" on storage.objects;
create policy "org_logos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-logos'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );
