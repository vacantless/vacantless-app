alter table public.organizations
  add column if not exists availability_tripwire_enabled boolean not null default false,
  add column if not exists availability_tripwire_lookahead_days integer not null default 7,
  add column if not exists availability_tripwire_thin_slots integer not null default 3,
  add column if not exists availability_tripwire_last_state text,
  add column if not exists availability_tripwire_last_alert_on date;
