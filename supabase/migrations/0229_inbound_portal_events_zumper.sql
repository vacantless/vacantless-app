-- ============================================================================
-- 0229_inbound_portal_events_zumper (S701d)
--
-- The lead ingest now reads Zumper's renter emails (noreply@zumperchat.com).
-- Every site email it handles is recorded in inbound_portal_events for the
-- landlord's "is my rule working" card, and the source CHECK only allowed
-- rentals_ca, kijiji and gmail_forwarding, so a Zumper row would be refused
-- (silently: the write is best-effort). Widen the CHECK to include zumper.
-- Additive. Idempotent: safe to re-run.
-- ============================================================================

alter table public.inbound_portal_events
  drop constraint if exists inbound_portal_events_source_check;

alter table public.inbound_portal_events
  add constraint inbound_portal_events_source_check
  check (source in ('rentals_ca', 'kijiji', 'zumper', 'gmail_forwarding'));
