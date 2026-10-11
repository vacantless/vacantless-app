-- ============================================================================
-- 0235_inbound_portal_events_scam_held (S705)
--
-- The lead ingest now holds landlord-phishing messages sent through a site's
-- contact form ("run our verification program or your account is blocked")
-- instead of filing them as leads. It records outcome 'scam_held' for the
-- org's "is my rule working" card, and the outcome CHECK did not allow it, so
-- the row would be refused (silently: the write is best-effort). Widen it.
-- Additive. Idempotent: safe to re-run.
-- ============================================================================

alter table public.inbound_portal_events
  drop constraint if exists inbound_portal_events_outcome_check;

alter table public.inbound_portal_events
  add constraint inbound_portal_events_outcome_check
  check (outcome in (
    'lead_created', 'duplicate', 'not_parsed',
    'auth_unverified', 'cross_org_refused', 'confirmation_code',
    'scam_held'
  ));
