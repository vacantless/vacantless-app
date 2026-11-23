-- S832b (Noam 2026-11-23): every account, paid or Free, gets one rental posted
-- by the robot at no charge, so moving from Free to a paid plan never takes
-- posting away. The free rental is whichever one already has live ads on
-- Kijiji, Rentals.ca or Zumper; with none, the rental being posted becomes it.
-- The Posting add-on still buys robot posting for every other rental.
--
-- SQL twin of lib/billing.ts robotPostingAllowedFor. Replaces the 0277 body
-- (Free and no other live rental). The claim already calls this per item
-- (0277), so nothing else changes.

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
        from public.distribution_run_items dri
        join public.distribution_runs r on r.id = dri.run_id
       where dri.id = p_item_id
         and dri.organization_id = p_organization_id
    ), false);
$$;

revoke all on function public.item_can_use_robot_posting(uuid, uuid) from public, anon, authenticated;
grant execute on function public.item_can_use_robot_posting(uuid, uuid) to service_role;
