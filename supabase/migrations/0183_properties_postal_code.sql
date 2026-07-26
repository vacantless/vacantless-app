-- ============================================================================
-- 0183_properties_postal_code
--
-- BACK-PORT (repo/prod parity, no prod write): applied to prod on 2026-07-23
-- (schema_migrations version 20260723023350, name "0182_properties_postal_code").
-- Renumbered to 0183 here because the repo's 0182 slot is occupied by
-- 0182_properties_unit_type_for_rent_by; both are independent idempotent
-- ADD COLUMN statements, so file order between them does not affect the rebuilt
-- schema. Body is the exact prod-applied SQL. See reference_migration_ledger_drift.
-- ============================================================================

ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS postal_code text;
COMMENT ON COLUMN public.properties.postal_code IS 'Optional Canadian postal code for reliable Kijiji/ILS location geocoding (S556). Nullable; dark until compose/app populate it.';
