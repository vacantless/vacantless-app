-- ============================================================================
-- 0184_grant_service_role_select_property_photos
--
-- BACK-PORT (repo/prod parity, no prod write): applied to prod on 2026-07-23
-- (schema_migrations version 20260723123643, name
-- "grant_service_role_select_property_photos"). Never committed to the repo.
-- Idempotent grant. See reference_migration_ledger_drift.
-- ============================================================================

-- The done-for-you worker (service_role) reads property_photos to attach a
-- listing's photos to the portal form. service_role was missing SELECT here
-- (only REFERENCES/TRIGGER/TRUNCATE), so the photo query returned empty silently
-- (same class as the s530 grant gap). Grant SELECT to close it.
grant select on public.property_photos to service_role;
