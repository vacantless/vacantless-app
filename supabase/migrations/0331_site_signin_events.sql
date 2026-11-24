-- S838 (REVIEW-S837 1.2a): record each robot-site sign-in and each loss with
-- its time, so the real sign-in lifetime per site (Kijiji, Rentals.ca, Zumper)
-- is measured before a stranger pays for Posting. Additive only.
-- Kept by the database itself (as listing_posts.down_at, 0330): the worker, the
-- sign-in window and the checks all write distribution_channel_sessions, so a
-- trigger there catches every path. "lost" uses the same rule as
-- lib/signin-lost SIGNIN_LOST_CODES (alive false with needs_login or
-- no_session); "signed_in" is the move to alive true from anything else.
create table if not exists public.site_signin_events (
  id              bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel         text not null,
  event           text not null check (event in ('signed_in', 'lost')),
  check_code      text,
  at              timestamptz not null default now()
);

create index if not exists site_signin_events_org_channel_at
  on public.site_signin_events (organization_id, channel, at);

comment on table public.site_signin_events is
  'S838: one row per robot-site sign-in (alive became true) and per loss (alive false with needs_login or no_session). Written only by the distribution_channel_sessions trigger.';

alter table public.site_signin_events enable row level security;
revoke all on public.site_signin_events from anon, authenticated;
grant select, insert on public.site_signin_events to service_role;
grant usage, select on sequence public.site_signin_events_id_seq to service_role;

create or replace function public.distribution_channel_sessions_log_signin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  now_lost boolean := new.alive = false and coalesce(new.last_check_code, '') in ('needs_login', 'no_session');
  was_lost boolean := tg_op = 'UPDATE' and old.alive = false and coalesce(old.last_check_code, '') in ('needs_login', 'no_session');
begin
  if new.channel not in ('kijiji', 'rentals_ca', 'zumper') then
    return new;
  end if;
  if now_lost and not was_lost then
    insert into public.site_signin_events (organization_id, channel, event, check_code)
    values (new.organization_id, new.channel, 'lost', new.last_check_code);
  elsif new.alive = true and (tg_op = 'INSERT' or old.alive is distinct from true) then
    insert into public.site_signin_events (organization_id, channel, event, check_code)
    values (new.organization_id, new.channel, 'signed_in', new.last_check_code);
  end if;
  return new;
end;
$$;

revoke all on function public.distribution_channel_sessions_log_signin() from public, anon, authenticated;

create or replace trigger distribution_channel_sessions_log_signin
  after insert or update of alive, last_check_code on public.distribution_channel_sessions
  for each row execute function public.distribution_channel_sessions_log_signin();
