-- 0164_sameday_showing_reminders.sql
-- S520: reliable same-day showing reminders plus renter confirmation identity.
--
-- Additive reminder stamps for the new coordinated same-day tier. The reminder
-- cron writes these via the existing service_role table-wide showings grant from
-- 0007_grant_service_role_reminder_tables.sql, so no column grant is needed.
--
-- The public renter confirm route already reuses showings.cancel_token; no
-- confirm_token column is added. Widen the existing confirmed_by check so that
-- the route can stamp confirmed_by='renter' while preserving the older 'lead'
-- and 'agent' values.

alter table public.showings
  add column if not exists reminder_sameday_sent_at timestamptz,
  add column if not exists reminder_sameday_sms_sent_at timestamptz;

comment on column public.showings.reminder_sameday_sent_at is
  'When the same-day viewing reminder email was sent (idempotency; channel-coordinated with reminder_sameday_sms_sent_at).';
comment on column public.showings.reminder_sameday_sms_sent_at is
  'When the same-day viewing reminder SMS was sent (idempotency; channel-coordinated with reminder_sameday_sent_at).';

alter table public.showings
  drop constraint if exists showings_confirmed_by_check;

alter table public.showings
  add constraint showings_confirmed_by_check
  check (confirmed_by is null or confirmed_by in ('agent', 'lead', 'renter'));
