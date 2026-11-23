-- S832b gap (Noam 2026-11-23): a robot post already under way for another
-- rental holds the account's one free robot rental too, so two rentals
-- approved in the same minute cannot both post free. Same as 0322 plus the
-- in-progress check. Twin of lib/robot-posting-access.ts.

create or replace function public.item_can_use_robot_posting(p_item_id uuid, p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.org_can_use_robot_posting(p_organization_id)
    or coalesce((
      select r.property_id is not null
         and not exists (
           select 1
             from public.listing_posts lp
            where lp.organization_id = p_organization_id
              and lp.status = 'live'
              and lp.portal in ('kijiji', 'rentals_ca', 'zumper')
              and lp.property_id is not null
              and lp.property_id <> r.property_id
         )
         and not exists (
           select 1
             from public.distribution_run_items oi
             join public.distribution_runs orun on orun.id = oi.run_id
            where oi.organization_id = p_organization_id
              and oi.id <> p_item_id
              and oi.status = 'in_progress'
              and oi.channel in ('kijiji', 'rentals_ca', 'zumper')
              and orun.property_id is not null
              and orun.property_id <> r.property_id
         )
        from public.distribution_run_items dri
        join public.distribution_runs r on r.id = dri.run_id
       where dri.id = p_item_id
         and dri.organization_id = p_organization_id
    ), false);
$$;

revoke all on function public.item_can_use_robot_posting(uuid, uuid) from public, anon, authenticated;
grant execute on function public.item_can_use_robot_posting(uuid, uuid) to service_role;
