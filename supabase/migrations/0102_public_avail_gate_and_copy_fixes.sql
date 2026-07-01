-- 0102_public_avail_gate_and_copy_fixes.sql
-- S399 - Codex S397b+S398 review follow-ups (2 findings, both forward-only, no
-- schema change; recreates two functions from 0101 with narrow corrections).
--
-- P2: get_public_availability regressed the TARGET-property public gate from
--     0018's `p.status = 'available'` back to `<> 'off_market'` (0101 rebuilt
--     the RPC off the older 0016 base). That let anon callers fetch org
--     availability for paused/draft/leased listings. Booking already rejected
--     non-available listings, so this was an over-exposure, not a booking
--     bypass. Restore `= 'available'` for the target property; cluster
--     candidates stay `<> 'off_market'` (unchanged, matches 0018).
-- P3: book_public_showing's activity note regressed "Viewing" -> "Showing"
--     (undoing 0038 renter-friendly copy). Restore "Viewing booked via...".
--
-- All other 0101 logic (days_off return, blackout enforcement, slot validation)
-- is reproduced verbatim so this is a clean superseding definition.

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
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'weekday',      a.weekday,
               'start_minute', a.start_minute,
               'end_minute',   a.end_minute)
             order by a.weekday, a.start_minute)
      from public.availability_rules a
      where a.organization_id = o.id
    ), '[]'::jsonb),
    'booked', coalesce((
      select jsonb_agg(s.scheduled_at)
      from public.showings s
      where s.organization_id = o.id
        and s.outcome = 'scheduled'
        and s.scheduled_at >= now()
    ), '[]'::jsonb),
    -- Operator days off (date-specific blackouts), today-or-later in the org tz.
    'days_off', coalesce((
      select jsonb_agg(to_char(d.day, 'YYYY-MM-DD') order by d.day)
      from public.availability_days_off d
      where d.organization_id = o.id
        and d.day >= (now() at time zone coalesce(o.booking_timezone, 'America/Toronto'))::date
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


create or replace function public.book_public_showing(
  p_lead_id     uuid,
  p_property_id uuid,
  p_slot        timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org          uuid;
  v_show         uuid;
  v_addr         text;
  v_tz           text;
  v_org_name     text;
  v_brand        text;
  v_logo         text;
  v_reply_to     text;
  v_sms_enabled  boolean;
  v_renter_name  text;
  v_renter_email text;
  v_renter_phone text;
  v_sms_opt_out  boolean;
  -- Slot-validation locals.
  v_slot_min     integer;
  v_lead_hours   integer;
  v_horizon      integer;
  v_local        timestamp;
  v_dow          integer;
  v_min_of_day   integer;
begin
  -- The unit must still be live (closes the lease-mid-inquiry edge case).
  if not exists (
    select 1 from public.properties
    where id = p_property_id and status = 'available'
  ) then
    raise exception 'Listing not available';
  end if;

  -- Lead must belong to the property's org and be freshly created.
  select l.organization_id, l.name, l.email, l.phone, l.sms_opt_out
    into v_org, v_renter_name, v_renter_email, v_renter_phone, v_sms_opt_out
  from public.leads l
  where l.id = p_lead_id
    and l.property_id = p_property_id
    and l.created_at > now() - interval '15 minutes';

  if v_org is null then
    raise exception 'Booking not allowed';
  end if;

  if p_slot <= now() then
    raise exception 'Slot is in the past';
  end if;

  -- ----------------------------------------------------------------------
  -- Server-side slot validation (mirrors lib/booking.ts isValidSlot). The
  -- TS action already checks this, but the RPC is anon-callable directly, so
  -- it must re-validate or a crafted call can book outside the rules.
  -- ----------------------------------------------------------------------
  select o.booking_timezone, o.booking_slot_minutes,
         o.booking_lead_hours, o.booking_horizon_days
    into v_tz, v_slot_min, v_lead_hours, v_horizon
  from public.organizations o
  where o.id = v_org;

  if v_slot_min is null or v_slot_min <= 0 then
    v_slot_min := 30;
  end if;

  -- Lead time: slot must be at least booking_lead_hours from now.
  if p_slot < now() + make_interval(hours => coalesce(v_lead_hours, 0)) then
    raise exception 'Slot is no longer available';
  end if;

  -- Horizon: the TS generator walks calendar days 0..horizon inclusive, so a
  -- one-day grace keeps the SQL bound from rejecting a valid edge-of-window slot.
  if p_slot > now() + make_interval(days => coalesce(nullif(v_horizon, 0), 14) + 1) then
    raise exception 'Slot is outside the booking window';
  end if;

  -- Weekday + within-window + grid-aligned against the org's availability rules.
  v_local      := p_slot at time zone coalesce(v_tz, 'America/Toronto');
  v_dow        := extract(dow  from v_local)::int;  -- 0=Sunday .. 6=Saturday
  v_min_of_day := (extract(hour from v_local)::int) * 60
                  + extract(minute from v_local)::int;

  -- Slots are always on a minute boundary (the generator zeroes seconds).
  if extract(second from v_local)::int <> 0 then
    raise exception 'Slot is not an offered showing time';
  end if;

  if not exists (
    select 1
    from public.availability_rules a
    where a.organization_id = v_org
      and a.weekday = v_dow
      and v_min_of_day >= a.start_minute
      and v_min_of_day + v_slot_min <= a.end_minute
      and ((v_min_of_day - a.start_minute) % v_slot_min) = 0
  ) then
    raise exception 'Slot is not an offered showing time';
  end if;

  -- Operator day off (date-specific blackout, S398): the slot's LOCAL date must
  -- not be a blocked day. Mirrors what generateSlots hides on the renter page.
  if exists (
    select 1
    from public.availability_days_off d
    where d.organization_id = v_org
      and d.day = (v_local)::date
  ) then
    raise exception 'Slot is not an offered showing time';
  end if;

  insert into public.showings
    (organization_id, lead_id, property_id, scheduled_at, outcome)
  values
    (v_org, p_lead_id, p_property_id, p_slot, 'scheduled')
  returning id into v_show;

  -- Advance the lead to booked. Broadened (C7): any state at-or-before booking,
  -- plus a re-engaged 'lost' lead. Leaves showed/applied/leased untouched so a
  -- rebooking never regresses real funnel progress.
  update public.leads
     set status = 'booked'
   where id = p_lead_id
     and status in ('new', 'replied', 'contacted', 'booked', 'lost');

  insert into public.messages
    (organization_id, lead_id, channel, direction, body)
  values
    (v_org, p_lead_id, 'note', 'inbound',
     'Viewing booked via the public listing page for '
       || to_char(p_slot at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');

  select p.address, o.name, o.brand_color, o.logo_url, o.booking_timezone,
         o.reply_to_email, o.sms_enabled
    into v_addr, v_org_name, v_brand, v_logo, v_tz, v_reply_to, v_sms_enabled
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id;

  return jsonb_build_object(
    'showing_id',       v_show,
    'scheduled_at',     p_slot,
    'timezone',         v_tz,
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'logo_url',         v_logo,
    'reply_to_email',   v_reply_to,
    'sms_enabled',      coalesce(v_sms_enabled, false),
    'sms_opt_out',      coalesce(v_sms_opt_out, false),
    'property_address', v_addr,
    'renter_name',      v_renter_name,
    'renter_email',     v_renter_email,
    'renter_phone',     v_renter_phone
  );
exception
  when unique_violation then
    raise exception 'That time was just taken';
end;
$$;
