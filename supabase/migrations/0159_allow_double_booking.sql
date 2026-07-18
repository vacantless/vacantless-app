alter table public.organizations
  add column if not exists allow_double_booking boolean not null default false;

alter table public.showings
  add column if not exists slot_lock text;

update public.showings s
set slot_lock = s.scheduled_at::text
where slot_lock is null;

create or replace function public.set_showing_slot_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_allow boolean;
begin
  if tg_op = 'UPDATE'
     and new.scheduled_at is not distinct from old.scheduled_at
     and new.organization_id is not distinct from old.organization_id
     and new.slot_lock is not null then
    return new;
  end if;

  select coalesce(o.allow_double_booking, false) into v_allow
    from public.organizations o
    where o.id = new.organization_id;

  new.slot_lock := case
    when v_allow then gen_random_uuid()::text
    else new.scheduled_at::text
  end;
  return new;
end $$;

drop trigger if exists trg_set_showing_slot_lock on public.showings;
create trigger trg_set_showing_slot_lock
  before insert or update on public.showings
  for each row execute function public.set_showing_slot_lock();

drop index if exists showings_org_slot_unique;
create unique index if not exists showings_org_slot_unique
  on public.showings (organization_id, slot_lock)
  where outcome = 'scheduled';

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
    -- clustering config
    'clustering_enabled',        o.clustering_enabled,
    'clustering_buffer_minutes', o.clustering_buffer_minutes,
    'showing_block_capacity',    o.showing_block_capacity,
    -- The target listing's own address, so the server action's isValidSlot can
    -- apply the same building clustering the renter page rendered (S400 P2).
    'target_address',            p.address,
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'weekday',      a.weekday,
               'start_minute', a.start_minute,
               'end_minute',   a.end_minute)
             order by a.weekday, a.start_minute)
      from public.availability_rules a
      where a.organization_id = o.id
    ), '[]'::jsonb),
    'booked', case when coalesce(o.allow_double_booking, false) then '[]'::jsonb
      else coalesce((
        select jsonb_agg(s.scheduled_at)
        from public.showings s
        where s.organization_id = o.id
          and s.outcome = 'scheduled'
          and s.scheduled_at >= now()
      ), '[]'::jsonb) end,
    -- Operator days off (date-specific blackouts), today-or-later in the org tz.
    'days_off', coalesce((
      select jsonb_agg(to_char(d.day, 'YYYY-MM-DD') order by d.day)
      from public.availability_days_off d
      where d.organization_id = o.id
        and d.day >= (now() at time zone coalesce(o.booking_timezone, 'America/Toronto'))::date
    ), '[]'::jsonb),
    -- Date-specific custom windows, today-or-later in the org tz. TS gives these
    -- lower precedence than days_off and higher precedence than weekly rules.
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day',          to_char(v.day, 'YYYY-MM-DD'),
               'start_minute', v.start_minute,
               'end_minute',   v.end_minute)
             order by v.day, v.start_minute)
      from public.availability_overrides v
      where v.organization_id = o.id
        and v.day >= (now() at time zone coalesce(o.booking_timezone, 'America/Toronto'))::date
    ), '[]'::jsonb),
    -- Future scheduled showings (address + time) for the org's currently-listed
    -- properties only. The TS filters these to the same building as p_property_id
    -- to derive that building's implicit anchor window(s). Off-market property
    -- addresses are never returned. Only meaningful when clustering is enabled,
    -- but always returned (cheap) so the page logic stays simple.
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

grant execute on function public.get_public_availability(uuid) to anon, authenticated;
