-- 0151_viewing_reminder_settings
-- Per-org weekly reminder to set viewing times. The cron pings often, but each
-- org self-gates by local weekday/hour plus viewing_reminder_last_sent_on.

alter table public.organizations
  add column if not exists viewing_reminder_enabled boolean not null default false,
  add column if not exists viewing_reminder_weekday smallint not null default 0,
  add column if not exists viewing_reminder_hour smallint not null default 17,
  add column if not exists viewing_reminder_last_sent_on date;

alter table public.organizations
  drop constraint if exists organizations_viewing_reminder_weekday_chk;
alter table public.organizations
  add constraint organizations_viewing_reminder_weekday_chk
  check (viewing_reminder_weekday between 0 and 6);

alter table public.organizations
  drop constraint if exists organizations_viewing_reminder_hour_chk;
alter table public.organizations
  add constraint organizations_viewing_reminder_hour_chk
  check (viewing_reminder_hour between 0 and 23);

comment on column public.organizations.viewing_reminder_enabled is
  'Whether this org receives the weekly leasing.viewing_availability_reminder when the next seven days have no bookable viewing times.';
comment on column public.organizations.viewing_reminder_weekday is
  'Org-local weekday for the viewing-times reminder, 0=Sunday through 6=Saturday.';
comment on column public.organizations.viewing_reminder_hour is
  'Org-local hour (0-23) at/after which the weekly viewing-times reminder can send.';
comment on column public.organizations.viewing_reminder_last_sent_on is
  'Org-local date the viewing-times reminder last evaluated/sent; gates the weekly app/api/cron/viewing-reminder sweep.';
