-- S734 (review item 5): the Posting add-on no longer needs a paid plan.
-- A landlord with one free rental pays $49 a month for Kijiji, Rentals.ca and
-- Zumper posting without paying $99 for Growth first. The SQL twin of
-- lib/billing.ts canUseRobotPosting now reads the flag alone; the Stripe
-- webhook still owns the flag (on while the subscription that carries the
-- add-on item is active, off when it ends).
create or replace function public.org_can_use_robot_posting(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.posting_addon_active
       from public.organizations o
      where o.id = p_organization_id),
    false
  );
$$;

revoke all on function public.org_can_use_robot_posting(uuid) from public, anon, authenticated;
grant execute on function public.org_can_use_robot_posting(uuid) to service_role;

comment on column public.organizations.posting_addon_active is
  'Posting add-on (robot posting to Kijiji, Rentals.ca, Zumper). Written by the Stripe webhook (service role) or migration 0244 grandfathering. Since 0256 the gate is this flag alone, on any plan.';
