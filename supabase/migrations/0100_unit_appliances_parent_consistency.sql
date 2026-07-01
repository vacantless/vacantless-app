-- 0100_unit_appliances_parent_consistency.sql
-- S395 follow-up to 0099 (the S388-S392 Codex P2 fix).
--
-- 0099 added a parent-consistency trigger to appliance_consumables that enforces
-- its denormalized org/property match its parent unit_appliances row. But that
-- guard trusts unit_appliances to itself be consistent, and unit_appliances (0082)
-- has the same looser shape: RLS only checks organization_id IN user_org_ids(), so
-- a direct authenticated write could denormalize an organization_id that does NOT
-- match the property_id's owning org. Closing the appliance-stack trust boundary
-- means enforcing that invariant at the parent too.
--
-- Scope (deliberately narrow): the appliance stack only. This does NOT touch the
-- older sibling asset tables (unit_equipment 0081 / unit_detectors 0080); that
-- would be a wider historical RLS pass, out of scope here.
--
-- Invariant enforced: unit_appliances.organization_id = the organization_id of the
-- property referenced by unit_appliances.property_id. BEFORE INSERT/UPDATE, every
-- writer/role. Additive, idempotent, reversible; no data change (unit_appliances is
-- empty in prod, and all existing sibling rows in QA are already consistent).

create or replace function public.unit_appliances_check_parent()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prop_org uuid;
begin
  select p.organization_id
    into v_prop_org
    from public.properties p
   where p.id = new.property_id;

  if v_prop_org is null then
    raise exception
      'unit_appliances: parent property % not found', new.property_id
      using errcode = '23503';
  end if;

  if new.organization_id is distinct from v_prop_org then
    raise exception
      'unit_appliances: organization_id % does not match property org %',
      new.organization_id, v_prop_org
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists unit_appliances_parent_consistency
  on public.unit_appliances;
create trigger unit_appliances_parent_consistency
  before insert or update on public.unit_appliances
  for each row execute function public.unit_appliances_check_parent();

comment on function public.unit_appliances_check_parent() is
  'S395/Codex P2 follow-up: BEFORE INSERT/UPDATE guard ensuring a unit_appliances row denormalizes the same organization_id that owns its property_id, so appliance_consumables_check_parent (0099) can trust the parent and the appliance-stack org/property invariant holds at the DB layer.';
