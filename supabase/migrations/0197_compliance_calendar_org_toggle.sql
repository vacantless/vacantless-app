-- ============================================================================
-- 0197_compliance_calendar_org_toggle — per-org opt-in for the compliance calendar
--
-- The compliance-calendar sweep (app/api/cron/compliance-calendar), its Settings
-- toggle (updateComplianceCalendarSettings), the Settings UI, and the org type +
-- select (lib/org.ts) all reference organizations.compliance_calendar_enabled.
--
-- Master gate stays: COMPLIANCE_CALENDAR_ENABLED (env) AND this org flag AND each
-- event-level notification_setting before anything drafts/sends. NOT NULL default
-- false so the cron's .eq('compliance_calendar_enabled', true) filter is
-- well-defined and the feature ships DARK (no org opted in).
-- ============================================================================

alter table public.organizations
  add column if not exists compliance_calendar_enabled boolean not null default false;

comment on column public.organizations.compliance_calendar_enabled is
  'Coarse per-org opt-in for the compliance-calendar sweep (VHT/seasonal water/ice/furnace/alarms/insurance/rent-increase reminders). Requires the COMPLIANCE_CALENDAR_ENABLED env master-switch + each event-level notification_setting. Default false => dark.';
