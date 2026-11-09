-- S767 (PLAN-S766 item F, Noam 2026-11-08): a Free account's one live rental
-- is posted by the robot at no charge (Rentals.ca and Zumper free; Kijiji at
-- the site's own fee, which the spend gate below still requires). The Posting
-- add-on buys robot posting from the second rental on.
--
-- SQL twin of lib/billing.ts robotPostingAllowedFor: the add-on, or the plan
-- is Free and no OTHER rental in the account is live. The worker claim reads
-- it per run item instead of org_can_use_robot_posting (kept for anything
-- else that reads it; unchanged).

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
      select coalesce(o.plan, 'free') = 'free'
         and r.property_id is not null
         and not exists (
           select 1
             from public.properties p
            where p.organization_id = p_organization_id
              and p.status = 'available'
              and p.archived_at is null
              and p.id <> r.property_id
         )
        from public.distribution_run_items dri
        join public.distribution_runs r on r.id = dri.run_id
        join public.organizations o on o.id = dri.organization_id
       where dri.id = p_item_id
         and dri.organization_id = p_organization_id
    ), false);
$$;

revoke all on function public.item_can_use_robot_posting(uuid, uuid) from public, anon, authenticated;
grant execute on function public.item_can_use_robot_posting(uuid, uuid) to service_role;

-- The claim body is unchanged except its first gate, which now asks per item.
-- Rewritten from the live definition so nothing else in it moves.
do $$
declare
  def text;
  old_gate constant text := 'not public.org_can_use_robot_posting(p_organization_id)';
  new_gate constant text := 'not public.item_can_use_robot_posting(p_item_id, p_organization_id)';
begin
  def := pg_get_functiondef('public.claim_approved_distribution_run_item_for_worker(uuid,uuid,text,uuid)'::regprocedure);
  if position(old_gate in def) = 0 then
    if position(new_gate in def) > 0 then
      return; -- already applied
    end if;
    raise exception 'claim gate not found; 0277 not applied';
  end if;
  execute replace(def, old_gate, new_gate);
end;
$$;
