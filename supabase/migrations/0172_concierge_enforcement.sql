-- 0172_concierge_enforcement.sql
-- Dark until CONCIERGE_DESK_ENABLED. Tables stay empty and the claim function is
-- unused until the concierge desk is flipped on for go-live.

create table if not exists public.concierge_usage (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period          text not null, -- 'YYYY-MM' (UTC)
  count           integer not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, period)
);

create table if not exists public.concierge_leaseup_claims (
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  period             text not null, -- 'YYYY-MM' (UTC)
  property_id         uuid not null references public.properties(id) on delete cascade,
  first_requested_at  timestamptz not null default now(),
  primary key (organization_id, period, property_id)
);

alter table public.organizations
  add column if not exists concierge_leaseup_cap_override integer;

alter table public.concierge_usage enable row level security;
alter table public.concierge_leaseup_claims enable row level security;

drop policy if exists concierge_usage_read on public.concierge_usage;
create policy concierge_usage_read on public.concierge_usage
  for select using (organization_id in (select public.user_org_ids()));

drop policy if exists concierge_leaseup_claims_read on public.concierge_leaseup_claims;
create policy concierge_leaseup_claims_read on public.concierge_leaseup_claims
  for select using (organization_id in (select public.user_org_ids()));

-- No INSERT/UPDATE/DELETE policy: writes go only through claim_concierge_leaseup().

create or replace function public.claim_concierge_leaseup(
  p_org uuid,
  p_period text,
  p_property uuid,
  p_cap integer
)
returns table(allowed boolean, used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap integer := greatest(coalesce(p_cap, 0), 0);
  v_count integer;
begin
  if not exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.user_id = auth.uid()
  ) then
    raise exception 'not a member of org %', p_org using errcode = '42501';
  end if;

  if exists (
    select 1 from public.concierge_leaseup_claims c
    where c.organization_id = p_org
      and c.period = p_period
      and c.property_id = p_property
  ) then
    select coalesce(cu.count, 0) into v_count
      from public.concierge_usage cu
      where cu.organization_id = p_org and cu.period = p_period;
    return query select true, coalesce(v_count, 0);
    return;
  end if;

  insert into public.concierge_usage(organization_id, period, count)
    values (p_org, p_period, 0)
    on conflict (organization_id, period) do nothing;

  select cu.count into v_count
    from public.concierge_usage cu
    where cu.organization_id = p_org and cu.period = p_period
    for update;

  if exists (
    select 1 from public.concierge_leaseup_claims c
    where c.organization_id = p_org
      and c.period = p_period
      and c.property_id = p_property
  ) then
    return query select true, v_count;
    return;
  end if;

  if v_count >= v_cap then
    return query select false, v_count;
  else
    insert into public.concierge_leaseup_claims(
      organization_id,
      period,
      property_id
    )
      values (p_org, p_period, p_property);

    update public.concierge_usage
      set count = count + 1, updated_at = now()
      where organization_id = p_org and period = p_period;

    return query select true, v_count + 1;
  end if;
end;
$$;

revoke all on function public.claim_concierge_leaseup(uuid, text, uuid, integer) from public, anon;
grant execute on function public.claim_concierge_leaseup(uuid, text, uuid, integer) to authenticated;
