-- S736: tell the landlord the moment a site signs them out.
-- The worker's daily session check flips alive=false (needs_login) when Kijiji,
-- Zumper or Rentals.ca has signed the landlord out; posting there stops until
-- they sign in again. Before this, only the site tile and our own health email
-- showed it. /api/cron/signin-lost (15-minute sweep) now emails the account's
-- owners once per sign-out and stamps this column; a working sign-in clears it.
alter table public.distribution_channel_sessions
  add column if not exists lost_notified_at timestamptz;

comment on column public.distribution_channel_sessions.lost_notified_at is
  'S736: when the landlord was emailed that this site signed them out; cleared once the sign-in works again.';
