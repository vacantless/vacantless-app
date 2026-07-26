-- ============================================================================
-- 0186_grant_service_role_admin_touched_tables
--
-- BACK-PORT (repo/prod parity, no prod write): applied to prod on 2026-07-20
-- (schema_migrations version 20260720164556, name
-- "s530_grant_service_role_admin_touched_tables"). Never committed to the repo.
-- Order-independent idempotent grants (all tables exist by their own earlier
-- migrations). See reference_migration_ledger_drift.
-- ============================================================================

grant select, insert, update, delete on table
  public.memberships,
  public.distribution_runs,
  public.distribution_run_items,
  public.distribution_publish_attempts,
  public.distribution_verifications,
  public.listing_posts
to service_role;
