-- 0165_operator_confirmation_layer.sql
-- S522: operator-side viewing confirmation layer.
--
-- Additive org settings only. Existing orgs stay in the current auto-confirm
-- posture by default; auto-release is explicitly opt-in and off for every org
-- until an operator turns it on after the migration is applied.

alter table public.organizations
  add column if not exists showing_confirm_mode text not null default 'auto',
  add column if not exists auto_release_unconfirmed_enabled boolean not null default false,
  add column if not exists auto_release_unconfirmed_hours integer not null default 2;

alter table public.organizations
  drop constraint if exists organizations_showing_confirm_mode_check;
alter table public.organizations
  add constraint organizations_showing_confirm_mode_check
  check (showing_confirm_mode in ('auto', 'agent'));

alter table public.organizations
  drop constraint if exists organizations_auto_release_unconfirmed_hours_range;
alter table public.organizations
  add constraint organizations_auto_release_unconfirmed_hours_range
  check (auto_release_unconfirmed_hours between 1 and 24);

comment on column public.organizations.showing_confirm_mode is
  'S522: viewing confirmation mode. auto = booked viewings proceed with renter reminders; agent = operator treats unconfirmed upcoming viewings as at-risk.';
comment on column public.organizations.auto_release_unconfirmed_enabled is
  'S522: opt-in auto-release for still-unconfirmed agent-mode viewings. Default false; no org is enabled by this migration.';
comment on column public.organizations.auto_release_unconfirmed_hours is
  'S522: how many hours before a viewing the reminders cron may auto-release an unconfirmed agent-mode viewing when enabled.';
