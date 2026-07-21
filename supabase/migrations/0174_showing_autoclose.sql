-- 0174_showing_autoclose.sql — S546 showing-outcome auto-close default (write path).
--
-- The pure core (lib/showing-autoclose.ts, the `auto_closed` outcome label in
-- lib/pipeline.ts, ShowingReport.autoClosed in lib/reports.ts) already landed on
-- 530badd but is INERT: showings.outcome has a CHECK constraint that only allows
-- scheduled/attended/no_show/cancelled (0001_init.sql:74), so nothing can write
-- 'auto_closed' yet. This migration opens that constraint and adds the per-org
-- opt-in the cron sweep reads. Ships safe: the columns default OFF, so no org
-- auto-closes anything until an operator turns it on in Settings.
--
-- Idempotent: re-runnable (drop-if-exists + add-if-not-exists + if-not-exists).

-- 1. Allow the honest terminal state on showings.outcome. The inline column
--    check from 0001 is auto-named public.showings_outcome_check; drop + recreate
--    it with 'auto_closed' added. auto_closed means "the showing passed and
--    nobody recorded an outcome, so the system closed it" — it is NOT attended
--    or no_show and never enters the attendance-rate math (lib/reports.ts).
alter table public.showings
  drop constraint if exists showings_outcome_check;
alter table public.showings
  add constraint showings_outcome_check
  check (outcome in ('scheduled', 'attended', 'no_show', 'cancelled', 'auto_closed'));

-- 2. Per-org opt-in + grace window. OFF by default: existing orgs stay off until
--    they turn it on. The hours bound (24..336 = 1h..14d) is enforced here and
--    again in the settings action + the pure core's AUTOCLOSE_MAX_AGE_MS bound.
alter table public.organizations
  add column if not exists showing_autoclose_enabled boolean not null default false;

alter table public.organizations
  add column if not exists showing_autoclose_after_hours integer not null default 48;

alter table public.organizations
  drop constraint if exists organizations_showing_autoclose_after_hours_check;
alter table public.organizations
  add constraint organizations_showing_autoclose_after_hours_check
  check (showing_autoclose_after_hours between 24 and 336);

-- 3. Grants. The reminders/outcome-nudge crons run as service_role. 0007 already
--    grants service_role update on showings + insert on messages, but re-assert
--    them here defensively (the S530/S539 grant-gap incidents were exactly a
--    silently-missing service_role grant). Re-granting an existing grant is a
--    no-op, so this is safe + idempotent.
grant select, update on public.showings to service_role;
grant insert on public.messages to service_role;
