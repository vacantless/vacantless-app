-- S720: the daily health email to Noam (app/api/cron/health-digest).
--
-- sweep_runs: one row per 15-minute background sweep (written by
-- /api/cron/sweep-all), so a sweep that failed overnight is still visible the
-- next morning. pg_net keeps HTTP responses only a few hours, so it cannot.
-- Rows older than 14 days are pruned by sweep-all itself.
--
-- platform_digest_runs: one row per digest per day. The digest route runs
-- every 15 minutes and claims today's row with ON CONFLICT DO NOTHING, so the
-- email goes out exactly once a day however many times the sweep fires.
--
-- Service role only (no policies): nothing here is shown in the app.

create table if not exists public.sweep_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  ran integer not null,
  failed text[] not null default '{}'
);
create index if not exists sweep_runs_ran_at_idx on public.sweep_runs (ran_at desc);
alter table public.sweep_runs enable row level security;
grant select, insert, delete on public.sweep_runs to service_role;
grant usage, select on sequence public.sweep_runs_id_seq to service_role;

create table if not exists public.platform_digest_runs (
  digest text not null,
  sent_on date not null,
  created_at timestamptz not null default now(),
  primary key (digest, sent_on)
);
alter table public.platform_digest_runs enable row level security;
grant select, insert, delete on public.platform_digest_runs to service_role;
