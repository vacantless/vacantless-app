-- 0297_funnel_visits (S800, REVIEW-S799 item 8)
-- One row per browser, per page, per day, for the two pages at the top of the
-- stranger's path: the homepage and the sign-up page. Written only by the
-- server (service key) from /api/funnel/visit; nobody reads it but the admin
-- console. No names, emails or addresses: a random browser id and the day.
-- Safe to run twice.
create table if not exists public.funnel_visits (
  visited_on date not null default ((now() at time zone 'America/Toronto')::date),
  visitor text not null check (visitor ~ '^[0-9a-f-]{36}$'),
  page text not null check (page in ('home', 'signup')),
  created_at timestamptz not null default now(),
  primary key (visited_on, visitor, page)
);

alter table public.funnel_visits enable row level security;
revoke all on public.funnel_visits from anon, authenticated;
-- S800e: the server writes and the admin console reads with the service key;
-- the table was made without a grant for it, so nothing was stored at first.
grant select, insert on public.funnel_visits to service_role;
