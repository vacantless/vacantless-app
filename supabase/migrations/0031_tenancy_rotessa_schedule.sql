-- ============================================================================
-- 0031_tenancy_rotessa_schedule — link a tenancy to its Rotessa rent schedule
-- (platform pivot step 2, increment 3: monthly rent schedule, S211)
--
-- Increment 2 (0030) stored the Rotessa CUSTOMER id on the tenancy. This
-- increment lets the dashboard create a monthly transaction_schedule (POST
-- /transaction_schedules) billed to that customer at the tenancy rent, and
-- remembers which schedule that tenancy maps to. The upcoming increment 4
-- (nightly transaction_report poll) reads status off the resulting financial
-- transactions.
--
-- Model (unchanged, locked S210): the schedule is created against the
-- landlord's OWN Rotessa account via their stored key; Vacantless never holds
-- funds or stores bank numbers. These columns hold only Rotessa's identifier
-- for the schedule, nothing sensitive.
--
--   * rotessa_schedule_id        — Rotessa's numeric transaction_schedule id,
--                                  stored as text. NULL until created.
--   * rotessa_schedule_synced_at — when we last created/confirmed that schedule.
--
-- Additive + nullable: no backfill, no constraint that can fail on existing
-- rows. Safe to apply ahead of the code deploy.
-- ============================================================================

alter table public.tenancies
  add column if not exists rotessa_schedule_id        text,
  add column if not exists rotessa_schedule_synced_at timestamptz;
