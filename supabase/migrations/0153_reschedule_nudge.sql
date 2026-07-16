-- 0153_reschedule_nudge.sql
-- S504 - one-shot reschedule proposal re-nudge, gated per org and capped per proposal.

alter table public.showing_reschedule_proposals
  add column if not exists reminded_at timestamptz;

alter table public.organizations
  add column if not exists reschedule_nudge_enabled boolean not null default false;

comment on column public.showing_reschedule_proposals.reminded_at is
  'When the one-shot reschedule re-nudge was sent for this pending proposal (null = not yet). Caps the nudge at one.';

comment on column public.organizations.reschedule_nudge_enabled is
  'Whether app/api/cron/reschedule-nudge re-emails an unresponded pending reschedule proposal once, N hours after it was created.';
