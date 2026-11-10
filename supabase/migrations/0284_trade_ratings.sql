-- ============================================================================
-- Vacantless - S776e: shared, rated local trades (PLAN-S775 Phase 4).
-- ============================================================================
-- The trade network (0055/0056) lets a landlord list a trade and others add it
-- ("Used by N landlords near you"). Landlords on the forums ask for one more
-- thing: was the work any good? This adds a rating after a job is done.
--   trade_ratings  one per completed work order: 1 to 5 stars and "would hire
--                  again". Private to the rating account (RLS); only a work
--                  order that is completed, in the same account, and done by
--                  that trade can be rated, so ratings come from real jobs.
--   trade_contacts.directory_trade_id  links a trade added from the network to
--                  its listing, so its ratings count toward that listing.
--   directory_trade_scores()  the one cross-account read: per listed trade, the
--                  average stars, how many rated jobs and how many landlords.
--                  Never who rated, never prices, never tenant data.
-- Additive: no rating changes nothing.
-- ============================================================================

alter table public.trade_contacts
  add column if not exists directory_trade_id uuid
    references public.directory_trades(id) on delete set null;

create table if not exists public.trade_ratings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  work_order_id    uuid not null references public.work_orders(id) on delete cascade,
  trade_contact_id uuid not null references public.trade_contacts(id) on delete cascade,
  stars            smallint not null check (stars between 1 and 5),
  hire_again       boolean,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (work_order_id)
);

create index if not exists trade_ratings_trade_idx on public.trade_ratings (trade_contact_id);

alter table public.trade_ratings enable row level security;

drop policy if exists trade_ratings_select_own on public.trade_ratings;
create policy trade_ratings_select_own on public.trade_ratings
  for select to authenticated
  using (organization_id in (select public.user_org_ids()));

-- A rating must come from a real, finished job by that trade in this account.
drop policy if exists trade_ratings_insert_own on public.trade_ratings;
create policy trade_ratings_insert_own on public.trade_ratings
  for insert to authenticated
  with check (
    organization_id in (select public.user_org_ids())
    and exists (
      select 1 from public.work_orders w
      where w.id = trade_ratings.work_order_id
        and w.organization_id = trade_ratings.organization_id
        and w.trade_contact_id = trade_ratings.trade_contact_id
        and w.status = 'completed'
    )
  );

drop policy if exists trade_ratings_update_own on public.trade_ratings;
create policy trade_ratings_update_own on public.trade_ratings
  for update to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists trade_ratings_delete_own on public.trade_ratings;
create policy trade_ratings_delete_own on public.trade_ratings
  for delete to authenticated
  using (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.trade_ratings to authenticated;
grant select, insert, update, delete on public.trade_ratings to service_role;

-- The one cross-account read: aggregates per listed, live listing only.
create or replace function public.directory_trade_scores()
returns table (directory_trade_id uuid, rating_avg numeric, rating_count integer, landlord_count integer)
language sql
stable
security definer
set search_path = public
as $$
  with rated as (
    select r.stars, r.organization_id,
           coalesce(c.directory_trade_id,
                    (select d.id from public.directory_trades d
                      where d.source_trade_contact_id = c.id
                      limit 1)) as dir_id
    from public.trade_ratings r
    join public.trade_contacts c on c.id = r.trade_contact_id
  )
  select x.dir_id,
         round(avg(x.stars)::numeric, 1),
         count(*)::integer,
         count(distinct x.organization_id)::integer
  from rated x
  join public.directory_trades d on d.id = x.dir_id
  where d.listed = true and d.archived = false
  group by x.dir_id;
$$;

revoke all on function public.directory_trade_scores() from public, anon;
grant execute on function public.directory_trade_scores() to authenticated, service_role;
