-- 0108_showing_cancel_token.sql
-- S418 - operator CANCELLATION notification loop (KI632, Vacantless-wide gap).
--
-- Problem: there is NO structured "the renter cancelled" path. A renter who
-- wants to cancel a booked viewing just REPLIES to the confirmation email, which
-- follows organizations.reply_to_email (and dead-ends at the shared sender when
-- that is unset). No leasing.showing_cancelled event exists, so on NO org does
-- an operator reliably learn a viewing was called off. That silently breaks the
-- operator-handoff thesis (the slot stays "booked", the renter list is wrong,
-- the freed time is never re-offered).
--
-- Fix (this migration + the /showing/cancel/[token] page + the new
-- leasing.showing_cancelled event): give every showing an unguessable
-- cancel_token, surface a "Cancel this viewing" link in the renter booking
-- confirmation email, and add a SECURITY DEFINER cancel_showing_from_token RPC
-- the unauthenticated confirm page POSTs to. The RPC re-derives the showing + org
-- SERVER-SIDE from the token, marks the showing cancelled, logs a note, and
-- returns the context the app needs to fire leasing.showing_cancelled to the
-- operator recipient list. Mirrors the 0097/0098 outcome-token precedent exactly
-- (unguessable token as the only credential; write is POST-only from the page so
-- an email link-scanner GET can never auto-cancel, KI585).
--
-- Deliberate scope: cancelling LEAVES THE LEAD STAGE UNCHANGED (mirrors the
-- authenticated updateShowingOutcome 'cancelled' path, which does not regress the
-- lead) so the operator decides the next step from the notification. Reversible.

-- 1. cancel_token column (unguessable per-showing handle). Backfills every
--    existing row via the default, exactly like outcome_token (0097).
alter table public.showings
  add column if not exists cancel_token uuid not null default gen_random_uuid();

create unique index if not exists showings_cancel_token_key
  on public.showings (cancel_token);


-- 2. Recreate book_public_showing (verbatim from 0103) with the ONLY change being
--    that the returned payload now carries cancel_token, so the app can build the
--    renter's "Cancel this viewing" link. Everything else (0102 = 'available'
--    gate, slot validation, day-off, S400 clustering/capacity, lead advance,
--    "Viewing booked" note) is reproduced unchanged.
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
  v_cancel_token uuid;
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
  -- Clustering locals (S400).
  v_cluster_enabled boolean;
  v_cluster_buffer  integer;
  v_cluster_cap     integer;
  v_building        text;
  v_anchor_count    integer;
  v_anchor_min      timestamptz;
  v_anchor_max      timestamptz;
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
  -- Server-side slot validation (mirrors lib/booking.ts isValidSlot).
  -- ----------------------------------------------------------------------
  select o.booking_timezone, o.booking_slot_minutes,
         o.booking_lead_hours, o.booking_horizon_days,
         o.clustering_enabled, o.clustering_buffer_minutes, o.showing_block_capacity
    into v_tz, v_slot_min, v_lead_hours, v_horizon,
         v_cluster_enabled, v_cluster_buffer, v_cluster_cap
  from public.organizations o
  where o.id = v_org;

  if v_slot_min is null or v_slot_min <= 0 then
    v_slot_min := 30;
  end if;

  -- Lead time: slot must be at least booking_lead_hours from now.
  if p_slot < now() + make_interval(hours => coalesce(v_lead_hours, 0)) then
    raise exception 'Slot is no longer available';
  end if;

  -- Horizon: one-day grace keeps the SQL bound from rejecting a valid edge slot.
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

  -- Operator day off (date-specific blackout, S398).
  if exists (
    select 1
    from public.availability_days_off d
    where d.organization_id = v_org
      and d.day = (v_local)::date
  ) then
    raise exception 'Slot is not an offered showing time';
  end if;

  -- Showing clustering ("Hero blocks", S400).
  if coalesce(v_cluster_enabled, false) then
    select building_key into v_building
    from public.properties where id = p_property_id;

    if v_building is not null and v_building <> '' then
      select count(*), min(s.scheduled_at), max(s.scheduled_at)
        into v_anchor_count, v_anchor_min, v_anchor_max
      from public.showings s
      join public.properties cp on cp.id = s.property_id
      where s.organization_id = v_org
        and cp.building_key = v_building
        and cp.status <> 'off_market'
        and s.outcome = 'scheduled'
        and s.scheduled_at >= now()
        and (s.scheduled_at at time zone coalesce(v_tz, 'America/Toronto'))::date
            = (v_local)::date;

      if coalesce(v_anchor_count, 0) > 0 then
        if v_anchor_count >= (case when coalesce(v_cluster_cap, 0) > 0
                                   then v_cluster_cap else 6 end) then
          raise exception 'Slot is not an offered showing time';
        end if;
        if p_slot < v_anchor_min - make_interval(mins => greatest(0, coalesce(v_cluster_buffer, 60)))
           or p_slot > v_anchor_max + make_interval(mins => greatest(0, coalesce(v_cluster_buffer, 60))) then
          raise exception 'Slot is not an offered showing time';
        end if;
      end if;
    end if;
  end if;

  insert into public.showings
    (organization_id, lead_id, property_id, scheduled_at, outcome)
  values
    (v_org, p_lead_id, p_property_id, p_slot, 'scheduled')
  returning id, cancel_token into v_show, v_cancel_token;

  -- Advance the lead to booked (C7).
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
    'cancel_token',     v_cancel_token,
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


-- 3. cancel_showing_from_token: the one-tap RPC the unauthenticated
--    /showing/cancel/[token] page POSTs to. SECURITY DEFINER, keyed on
--    cancel_token, re-derives showing + org server-side. Marks the showing
--    cancelled, logs a renter-side note, and LEAVES THE LEAD STAGE UNCHANGED
--    (the operator decides the next step). Idempotent: a second cancel returns
--    ok with already=true so the caller does not double-notify. Returns the
--    context the app fires leasing.showing_cancelled with. Granted to anon (the
--    page has no session); the token is the credential and a wrong token reveals
--    nothing. Mirrors record_showing_outcome_from_token (0098).
create or replace function public.cancel_showing_from_token(
  p_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_showing public.showings%rowtype;
  v_org_name  text;
  v_addr      text;
  v_tz        text;
  v_lead_name text;
  v_already   boolean := false;
begin
  select * into v_showing
  from public.showings
  where cancel_token = p_token
  for update;
  if v_showing.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Already cancelled -> idempotent no-op, but flag it so the caller does not
  -- fire a second operator notification for the same cancellation.
  if v_showing.outcome = 'cancelled' then
    v_already := true;
  else
    update public.showings
       set outcome = 'cancelled'
     where id = v_showing.id;

    if v_showing.lead_id is not null then
      insert into public.messages (organization_id, lead_id, channel, direction, body)
      values (v_showing.organization_id, v_showing.lead_id, 'note', 'inbound',
              'Viewing cancelled by the renter via the confirmation email link.');
    end if;
  end if;

  -- Context for the confirm page + the operator notification.
  select o.name, o.booking_timezone, p.address
    into v_org_name, v_tz, v_addr
  from public.organizations o
  left join public.properties p on p.id = v_showing.property_id
  where o.id = v_showing.organization_id;

  if v_showing.lead_id is not null then
    select l.name into v_lead_name from public.leads l where l.id = v_showing.lead_id;
  end if;

  return jsonb_build_object(
    'ok',               true,
    'already',          v_already,
    'organization_id',  v_showing.organization_id,
    'lead_id',          v_showing.lead_id,
    'property_id',      v_showing.property_id,
    'lead_name',        v_lead_name,
    'org_name',         v_org_name,
    'property_address', v_addr,
    'scheduled_at',     v_showing.scheduled_at,
    'timezone',         v_tz
  );
end;
$$;

grant execute on function public.cancel_showing_from_token(uuid)
  to anon, authenticated;
