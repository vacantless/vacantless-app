-- S767 (PLAN-S766 item C): time to first live, measured.
-- organizations.ad_conversions.first_live (0251) is stamped only for Google
-- Ads sign-ups, so 0 of 13 accounts had it. first_live_at is set once, the
-- first time any rental in the account becomes available (every path: Set
-- Live, publish, relist, the distribution run, a direct insert), and never
-- moves after that. One trigger, so no code path can forget it.

alter table public.organizations
  add column if not exists first_live_at timestamptz;

comment on column public.organizations.first_live_at is
  'First time a rental in this account became available. Set once by trigger properties_stamp_first_live. Rows before 0276 are backfilled from the earliest listing post or live/leased rental, so older values are the earliest possible time, not an exact one.';

create or replace function public.stamp_org_first_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'available'
     and (tg_op = 'INSERT' or old.status is distinct from 'available') then
    update public.organizations
       set first_live_at = now()
     where id = new.organization_id
       and first_live_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_org_first_live() from public, anon, authenticated;

drop trigger if exists properties_stamp_first_live on public.properties;
create trigger properties_stamp_first_live
  after insert or update of status on public.properties
  for each row execute function public.stamp_org_first_live();

-- Backfill: the earliest of the first listing post, the Google Ads stamp, and
-- the earliest rental that is live or leased now. Null where nothing went live.
update public.organizations o
   set first_live_at = sub.first_live
  from (
    select o2.id,
           least(
             (select min(lp.created_at) from public.listing_posts lp where lp.organization_id = o2.id),
             (select min(p.created_at) from public.properties p
               where p.organization_id = o2.id and p.status in ('available', 'leased')),
             case when (o2.ad_conversions ->> 'first_live') ~ '^\d{4}-\d{2}-\d{2}'
                  then (o2.ad_conversions ->> 'first_live')::timestamptz end
           ) as first_live
      from public.organizations o2
  ) sub
 where o.id = sub.id
   and o.first_live_at is null
   and sub.first_live is not null;
