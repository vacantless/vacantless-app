-- 0328_funnel_sections (S835i)
-- How far down the homepage each browser got: one row per browser, per
-- homepage section, per day. Written only by the server (service key) from
-- /api/funnel/seen; nobody reads it but the admin console. No names, emails
-- or addresses: the same random browser id as funnel_visits, and the day.
-- Safe to run twice.
create table if not exists public.funnel_sections (
  visited_on date not null default ((now() at time zone 'America/Toronto')::date),
  visitor text not null check (visitor ~ '^[0-9a-f-]{36}$'),
  section text not null check (section ~ '^[a-z0-9-]{1,40}$'),
  created_at timestamptz not null default now(),
  primary key (visited_on, visitor, section)
);

alter table public.funnel_sections enable row level security;
revoke all on public.funnel_sections from anon, authenticated;
grant select, insert on public.funnel_sections to service_role;
