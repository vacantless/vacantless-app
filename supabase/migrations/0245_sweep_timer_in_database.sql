-- S713e (Noam, 2026-10-13): the 15-minute background sweeps get a reliable timer.
--
-- GitHub Actions' schedule was the only 15-minute timer (reminders.yml) and it
-- ran hours apart on 2026-10-12/13 (8:54 PM, 3:16 AM, 11:10 AM). Vercel Hobby
-- allows only daily timers. The database's own scheduler (pg_cron) now calls
-- /api/cron/sweep-all every 15 minutes through pg_net. GitHub stays on as a
-- backup; every sweep is idempotent.
--
-- The caller proves itself with a secret generated HERE, kept in Supabase
-- Vault, and checked by sweep_trigger_secret_matches(). It never leaves the
-- database, so nobody types or pastes it anywhere.
--
-- GRANT check: one new function, service_role only (the route's admin client).
-- No new table.

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'sweep_trigger_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'sweep_trigger_secret',
      'S713e: the database timer''s password for /api/cron/sweep-all. Generated here; never copied out.'
    );
  end if;
end
$$;

create or replace function public.sweep_trigger_secret_matches(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_secret, '') <> ''
     and exists (
       select 1
         from vault.decrypted_secrets s
        where s.name = 'sweep_trigger_secret'
          and s.decrypted_secret = p_secret
     );
$$;

revoke all on function public.sweep_trigger_secret_matches(text) from public, anon, authenticated;
grant execute on function public.sweep_trigger_secret_matches(text) to service_role;

-- Re-runnable: drop the job first if it exists.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'vacantless-sweeps') then
    perform cron.unschedule('vacantless-sweeps');
  end if;
end
$$;

select cron.schedule(
  'vacantless-sweeps',
  '*/15 * * * *',
  $job$
    select net.http_get(
      url := 'https://vacantless-app.vercel.app/api/cron/sweep-all',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sweep_trigger_secret')
      ),
      timeout_milliseconds := 60000
    );
  $job$
);
