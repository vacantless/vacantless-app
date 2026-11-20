-- 0316_viewing_times_opened_switch.sql
-- S824g: an on/off switch for the "new viewing times are open" email and text
-- that goes to renters who found no time. On for every account, so nothing
-- changes until someone turns it off on Every message we send.

alter table public.organizations
  add column if not exists viewing_times_opened_enabled boolean not null default true;
