-- ============================================================================
-- Vacantless - S724 (Codex V251-24): viewing rules per rental.
-- ============================================================================
-- Notice and "confirm each viewing" were account-wide only. A rental that is
-- still occupied needs its own: Ontario asks for 24 hours' written notice to
-- the tenant, and the landlord may want to confirm every viewing and open no
-- times before a set date. Three optional columns on properties; null keeps
-- the account's setting.
--   viewing_earliest_date          no self-booked viewing before this date
--   viewing_lead_hours             minimum notice for this rental
--   viewing_requires_confirmation  renters are told you confirm each viewing
-- Applied in:
--   * get_public_availability: lead_hours and earliest_date per rental;
--   * book_public_showing: re-checks both (a crafted RPC call cannot skip them);
--   * get_public_listing / get_booking_confirmation_extras: the confirm flag.
-- Additive: with every column null nothing changes.
-- ============================================================================

alter table public.properties
  add column if not exists viewing_earliest_date date,
  add column if not exists viewing_lead_hours integer
    check (viewing_lead_hours is null or (viewing_lead_hours between 0 and 336)),
  add column if not exists viewing_requires_confirmation boolean;

-- 1. Public availability (0237 body, with the per-rental lead and date).
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
    'lead_hours',   coalesce(p.viewing_lead_hours, o.booking_lead_hours),
    'earliest_date', to_char(p.viewing_earliest_date, 'YYYY-MM-DD'),
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

-- 2. Booking RPC: per-rental notice and earliest date, inserted right before
--    the account lead-time check so every existing check stays as deployed.
do $mig$
declare
  d text;
  anchor constant text := '  -- Lead time: slot must be at least booking_lead_hours from now.';
  guard constant text :=
'  -- S724: per-rental viewing rules. A rental''s own notice wins over the
  -- account''s, and no viewing before its earliest date.
  select coalesce(pr.viewing_lead_hours, v_lead_hours) into v_lead_hours
  from public.properties pr where pr.id = p_property_id;
  if exists (
    select 1 from public.properties pr
    where pr.id = p_property_id
      and pr.viewing_earliest_date is not null
      and (p_slot at time zone coalesce(v_tz, ''America/Toronto''))::date < pr.viewing_earliest_date
  ) then
    raise exception ''Slot is not an offered showing time'';
  end if;

';
begin
  d := pg_get_functiondef('public.book_public_showing(uuid,uuid,timestamptz)'::regprocedure);
  if position('S724: per-rental viewing rules' in d) > 0 then
    return; -- already applied
  end if;
  if position(anchor in d) = 0 then
    raise exception 'S724: book_public_showing anchor not found; not modified';
  end if;
  d := replace(d, anchor, guard || anchor);
  execute d;
end
$mig$;

-- 3. The confirm flag renters see: the rental's own, else the account's.
do $mig$
declare
  d text;
  f text;
begin
  foreach f in array array['public.get_public_listing(uuid)', 'public.get_booking_confirmation_extras(uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('coalesce(p.viewing_requires_confirmation' in d) > 0 then
      continue; -- already applied
    end if;
    if position('''booking_requires_confirmation'', o.booking_requires_confirmation' in d) = 0 then
      raise exception 'S724: % anchor not found; not modified', f;
    end if;
    d := replace(
      d,
      '''booking_requires_confirmation'', o.booking_requires_confirmation',
      '''booking_requires_confirmation'', coalesce(p.viewing_requires_confirmation, o.booking_requires_confirmation)'
    );
    execute d;
  end loop;
end
$mig$;
