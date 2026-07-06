-- S425 Slice 1b: lease-OCR monthly usage cap (a runaway/abuse backstop for the
-- per-use model/API cost). A per-org, per-month counter plus an atomic claim
-- function. The counter is written ONLY through the SECURITY DEFINER claim
-- function, so a member cannot reset their own count. Feature ships DARK, so this
-- table is empty and the function unused until LEASE_OCR_ENABLED is set.

create table if not exists public.lease_ocr_usage (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period          text not null,               -- 'YYYY-MM' (UTC)
  count           integer not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, period)
);

alter table public.lease_ocr_usage enable row level security;

-- Members may READ their org's usage (for the "X of Y this month" display).
drop policy if exists lease_ocr_usage_read on public.lease_ocr_usage;
create policy lease_ocr_usage_read on public.lease_ocr_usage
  for select using (organization_id in (select public.user_org_ids()));
-- No INSERT/UPDATE/DELETE policy: writes go only through claim_lease_ocr_scan().

-- Atomically claim one scan credit for the current period IF under the cap.
-- Returns the post-claim usage and whether it was allowed. Membership-guarded so
-- a caller can only claim for an org they belong to.
create or replace function public.claim_lease_ocr_scan(p_org uuid, p_period text, p_cap integer)
returns table(allowed boolean, used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.user_id = auth.uid()
  ) then
    raise exception 'not a member of org %', p_org using errcode = '42501';
  end if;

  insert into public.lease_ocr_usage(organization_id, period, count)
    values (p_org, p_period, 0)
    on conflict (organization_id, period) do nothing;

  select luo.count into v_count
    from public.lease_ocr_usage luo
    where luo.organization_id = p_org and luo.period = p_period
    for update;

  if v_count >= p_cap then
    return query select false, v_count;
  else
    update public.lease_ocr_usage
      set count = count + 1, updated_at = now()
      where organization_id = p_org and period = p_period;
    return query select true, v_count + 1;
  end if;
end;
$$;

revoke all on function public.claim_lease_ocr_scan(uuid, text, integer) from public, anon;
grant execute on function public.claim_lease_ocr_scan(uuid, text, integer) to authenticated;
