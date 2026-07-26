-- ============================================================================
-- 0185_grant_service_role_showing_reschedule_proposals
--
-- BACK-PORT (repo/prod parity, no prod write): applied to prod on 2026-07-20
-- (schema_migrations version 20260720155851, name
-- "s539_grant_service_role_showing_reschedule_proposals"). Never committed to
-- the repo. Order-independent idempotent grant (the table exists from 0149).
-- See reference_migration_ledger_drift.
-- ============================================================================

grant select, insert, update, delete on table public.showing_reschedule_proposals to service_role;
