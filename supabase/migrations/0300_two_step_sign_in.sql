-- S803: two-step sign-in (REVIEW-S799 item 11, lib/two-step.ts).
-- A login that has turned on two-step sign-in must pass its phone code before
-- it can read or write any account data, even when it talks to the database
-- directly with the public key and skips the app. Logins without a code see
-- no change: two_step_ok() is true for them. Service-key work bypasses row
-- security and is untouched. Signed-out (anon) access is untouched.

create or replace function public.two_step_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;

revoke execute on function public.two_step_ok() from public, anon;
grant execute on function public.two_step_ok() to authenticated, service_role;

-- One restrictive policy on every public table that has row security on.
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists two_step_required on public.%I', t.relname);
    execute format(
      'create policy two_step_required on public.%I as restrictive for all to authenticated using ((select public.two_step_ok())) with check ((select public.two_step_ok()))',
      t.relname
    );
  end loop;
end $$;
