-- ============================================================================
-- Vacantless - S708: viewing days per building.
-- ============================================================================
-- Aaliyah (Agile) asked to show each building on its own day, e.g. Tuesday for
-- 1195 Bruce and Wednesday for 833 Pillette. Viewing hours were org-wide only.
--
-- availability_building_days: "this building shows only on these weekdays".
-- A building with NO rows keeps today's behaviour (every weekly window).
-- Applied in both slot paths:
--   * get_public_availability: the listing's weekly windows and specific-date
--     hours are limited to its building's weekdays;
--   * book_public_showing: re-rejects a slot on another weekday, so a crafted
--     direct RPC call cannot book a building on its off day.
-- Additive: with no rows nothing changes.
-- ============================================================================

create table if not exists public.availability_building_days (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  building_key    text not null,
  weekday         smallint not null check (weekday between 0 and 6),
  created_at      timestamptz not null default now(),
  unique (organization_id, building_key, weekday)
);

create index if not exists idx_availability_building_days_org
  on public.availability_building_days (organization_id, building_key);

alter table public.availability_building_days enable row level security;

create policy availability_building_days_all on public.availability_building_days
  for all
  using (organization_id in (select user_org_ids()))
  with check (organization_id in (select user_org_ids()));

-- Written directly by the operator dashboard (user session), so it needs
-- table privileges; RLS still scopes rows. service_role reads it for crons.
grant select, insert, update, delete on public.availability_building_days to authenticated;
grant select on public.availability_building_days to service_role;

-- 1. Public availability: limit weekly windows + specific-date hours to the
--    listing's building days (when that building has any).
create or replace function public.get_public_availability(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'timezone',     o.booking_timezone,
    'slot_minutes', o.booking_slot_minutes,
    'lead_hours',   o.booking_lead_hours,
    'horizon_days', o.booking_horizon_days,
    'clustering_enabled',        o.clustering_enabled,
    'clustering_buffer_minutes', o.clustering_buffer_minutes,
    'showing_block_capacity',    o.showing_block_capacity,
    'target_address',            p.address,
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'weekday',      a.weekday,
               'start_minute', a.start_minute,
               'end_minute',   a.end_minute)
             order by a.weekday, a.start_minute)
      from public.availability_rules a
      where a.organization_id = o.id
        and (
          not exists (
            select 1 from public.availability_building_days b
            where b.organization_id = o.id and b.building_key = p.building_key
          )
          or a.weekday in (
            select b.weekday from public.availability_building_days b
            where b.organization_id = o.id and b.building_key = p.building_key
          )
        )
    ), '[]'::jsonb),
    'booked', case when coalesce(o.allow_double_booking, false) then '[]'::jsonb
      else coalesce((
        select jsonb_agg(s.scheduled_at)
        from public.showings s
        where s.organization_id = o.id
          and s.outcome = 'scheduled'
          and s.scheduled_at >= now()
      ), '[]'::jsonb) end,
    'days_off', coalesce((
      select jsonb_agg(to_char(d.day, 'YYYY-MM-DD') order by d.day)
      from public.availability_days_off d
      where d.organization_id = o.id
        and d.day >= (now() at time zone coalesce(o.booking_timezone, 'America/Toronto'))::date
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day',          to_char(v.day, 'YYYY-MM-DD'),
               'start_minute', v.start_minute,
               'end_minute',   v.end_minute)
             order by v.day, v.start_minute)
      from public.availability_overrides v
      where v.organization_id = o.id
        and v.day >= (now() at time zone coalesce(o.booking_timezone, 'America/Toronto'))::date
        and (
          not exists (
            select 1 from public.availability_building_days b
            where b.organization_id = o.id and b.building_key = p.building_key
          )
          or extract(dow from v.day)::int in (
            select b.weekday from public.availability_building_days b
            where b.organization_id = o.id and b.building_key = p.building_key
          )
        )
    ), '[]'::jsonb),
    'cluster_candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'address',      cp.address,
               'scheduled_at', s.scheduled_at)
             order by s.scheduled_at)
      from public.showings s
      join public.properties cp on cp.id = s.property_id
      where s.organization_id = o.id
        and s.outcome = 'scheduled'
        and s.scheduled_at >= now()
        and cp.status <> 'off_market'
    ), '[]'::jsonb)
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id
    and p.status = 'available';
$$;

-- 2. Anon booking RPC: insert one guard into the CURRENT definition, right
--    before the specific-date override count, so every existing check stays
--    exactly as deployed. Fails loudly if the anchor text has moved.
do $mig$
declare
  d text;
  anchor constant text := '  select count(*) into v_override_count';
  guard constant text :=
'  -- S708: building viewing days. A building with rows shows only on those weekdays.
  if exists (
    select 1
    from public.availability_building_days b
    join public.properties bp on bp.building_key = b.building_key
    where bp.id = p_property_id
      and b.organization_id = v_org
  ) and not exists (
    select 1
    from public.availability_building_days b
    join public.properties bp on bp.building_key = b.building_key
    where bp.id = p_property_id
      and b.organization_id = v_org
      and b.weekday = v_dow
  ) then
    raise exception ''Slot is not an offered showing time'';
  end if;

';
begin
  d := pg_get_functiondef('public.book_public_showing(uuid,uuid,timestamptz)'::regprocedure);
  if position(anchor in d) = 0 then
    raise exception 'S708: book_public_showing anchor not found; not modified';
  end if;
  if position('S708: building viewing days' in d) > 0 then
    return; -- already applied
  end if;
  d := replace(d, anchor, guard || anchor);
  execute d;
end
$mig$;
