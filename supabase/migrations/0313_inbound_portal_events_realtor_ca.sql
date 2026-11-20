-- 0313_inbound_portal_events_realtor_ca.sql
-- S823d: Realtor.ca enquiry emails are read for an agent's rental listings.
-- The per-site event log (0227, widened for Zumper in 0229) must accept the
-- new source, or its "an enquiry arrived" rows are refused by the check.
-- Constraint change on an existing table: the table's grants already cover it.

alter table public.inbound_portal_events
  drop constraint if exists inbound_portal_events_source_check;

alter table public.inbound_portal_events
  add constraint inbound_portal_events_source_check
  check (source in ('rentals_ca', 'kijiji', 'zumper', 'realtor_ca', 'gmail_forwarding'));
