-- S748: page crashes, recorded. Before this a crash on a landlord's or a
-- renter's page lived only in Vercel's logs, which nobody reads, and the daily
-- health email said "Not checked here: app errors". The error pages
-- (app/error.tsx, app/global-error.tsx) post one row through
-- /api/report-error; the health email counts the last 24 hours.
-- Service role only. No message text from the browser is trusted for display
-- beyond a short, capped string.
create table if not exists public.app_errors (
  id bigserial primary key,
  at timestamptz not null default now(),
  path text,
  digest text,
  message text,
  kind text not null default 'page'
);
create index if not exists app_errors_at_idx on public.app_errors (at desc);
alter table public.app_errors enable row level security;
-- No policies on purpose: only the service role reads or writes it.
grant select, insert, delete on public.app_errors to service_role;
grant usage, select on sequence public.app_errors_id_seq to service_role;
