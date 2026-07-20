-- 0171_leased_outcomes.sql
-- Start capturing proprietary leased-result comps going forward.
--
-- Honesty rule: this migration does not backfill unknowable historical
-- availability windows. available_since null means unknown, and
-- days_on_market remains null instead of guessing.

alter table public.properties
  add column if not exists available_since timestamptz;

comment on column public.properties.available_since is
  'Stamped by trigger when status transitions to available; null means unknown for rows that predate the trigger.';

create table if not exists public.leased_outcomes (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  property_id        uuid not null references public.properties(id) on delete cascade,
  asking_rent_cents  integer,
  beds               integer,
  baths              numeric(3, 1),
  sqft               integer,
  city               text,
  address            text,
  available_since    timestamptz,
  leased_at          timestamptz not null default now(),
  days_on_market     integer,
  created_at         timestamptz not null default now()
);

comment on table public.leased_outcomes is
  'Forward-only snapshot of listing facts when a property transitions to leased; no fabricated backfill.';

create index if not exists leased_outcomes_org_property_idx
  on public.leased_outcomes(organization_id, property_id);

create index if not exists leased_outcomes_org_leased_at_idx
  on public.leased_outcomes(organization_id, leased_at desc);

alter table public.leased_outcomes enable row level security;

drop policy if exists leased_outcomes_select on public.leased_outcomes;
create policy leased_outcomes_select on public.leased_outcomes
  for select
  using (organization_id in (select public.user_org_ids()));

revoke all on public.leased_outcomes from anon;
revoke all on public.leased_outcomes from authenticated;

grant select on public.leased_outcomes to authenticated;
grant select, insert, update, delete on public.leased_outcomes to service_role;

create or replace function public.capture_property_leased_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_days_on_market integer;
begin
  if old.status is distinct from new.status and new.status = 'available' then
    update public.properties
       set available_since = v_now
     where id = new.id;
    return null;
  end if;

  if old.status is distinct from new.status and new.status = 'leased' then
    if exists (
      select 1
        from public.leased_outcomes lo
       where lo.property_id = new.id
         and lo.leased_at >= v_now - interval '1 minute'
    ) then
      return null;
    end if;

    v_days_on_market :=
      case
        when new.available_since is null then null
        else greatest(
          0,
          floor(extract(epoch from (v_now - new.available_since)) / 86400)::integer
        )
      end;

    insert into public.leased_outcomes (
      organization_id,
      property_id,
      asking_rent_cents,
      beds,
      baths,
      sqft,
      city,
      address,
      available_since,
      leased_at,
      days_on_market
    ) values (
      new.organization_id,
      new.id,
      new.rent_cents,
      new.beds,
      new.baths,
      new.sqft,
      null,
      new.address,
      new.available_since,
      v_now,
      v_days_on_market
    );
  end if;

  return null;
end;
$$;

drop trigger if exists properties_capture_leased_outcome on public.properties;
create trigger properties_capture_leased_outcome
after update of status on public.properties
for each row
execute function public.capture_property_leased_outcome();
