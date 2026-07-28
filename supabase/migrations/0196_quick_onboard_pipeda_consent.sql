-- ============================================================================
-- 0196_quick_onboard_pipeda_consent
--
-- Quick Onboard records whether the operator captured opt-in consent for future
-- brokerage / real-estate contact while adding a landlord and lease. This is
-- intentionally only the audit stamp; final ToS / Privacy wording is a legal
-- deliverable outside this migration.
-- ============================================================================

alter table public.organizations
  add column if not exists pipeda_marketing_consent_at timestamptz,
  add column if not exists pipeda_marketing_consent_by text;

comment on column public.organizations.pipeda_marketing_consent_at is
  'Timestamp when Quick Onboard recorded opt-in consent for future brokerage / real-estate contact. NULL means no consent is recorded.';

comment on column public.organizations.pipeda_marketing_consent_by is
  'Actor identifier recorded when Quick Onboard captured opt-in consent. Legal wording lives outside this schema stamp.';
