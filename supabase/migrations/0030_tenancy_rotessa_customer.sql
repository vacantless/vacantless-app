-- ============================================================================
-- 0030_tenancy_rotessa_customer — link a tenancy to its Rotessa customer
-- (platform pivot step 2, increment 2: create-customer-from-primary-tenant, S211)
--
-- Increment 1 (0029) connected the LANDLORD's own Rotessa account. This
-- increment lets the dashboard create a Rotessa *customer* from a tenancy's
-- PRIMARY tenant (POST /customers) and remember which Rotessa customer that
-- tenancy maps to. The upcoming increment 3 (a monthly transaction_schedule)
-- and increment 4 (the nightly status poll) both key off this reference.
--
-- Model (unchanged, locked S210): we send only name/email/phone + a stable
-- custom_identifier — NEVER bank/PAD/account numbers. The Rotessa customer is a
-- shell; the tenant authorizes their bank details directly in Rotessa. So these
-- columns hold only Rotessa's own identifier for the customer, nothing sensitive.
--
--   * rotessa_customer_id        — Rotessa's numeric customer id, stored as text
--                                  (the canonical reference for future schedule
--                                  + report calls). NULL until created.
--   * rotessa_customer_synced_at — when we last created/confirmed that customer.
--
-- The custom_identifier we send to Rotessa is the tenancy id itself (a stable,
-- unique Vacantless ref), so it doesn't need its own column.
--
-- Additive + nullable: no backfill, no constraint that can fail on existing
-- rows. Safe to apply ahead of the code deploy (the live app simply doesn't
-- select these columns yet).
-- ============================================================================

alter table public.tenancies
  add column if not exists rotessa_customer_id        text,
  add column if not exists rotessa_customer_synced_at timestamptz;
