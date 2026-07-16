-- 0150_reschedule_move_capacity_self_exclude.sql
-- S499 Part A: a reschedule move must not count the moving showing as its own
-- clustering anchor. Recreate only accept_reschedule_proposal from 0149.

create or replace function public.accept_reschedule_proposal(
  p_token uuid,
  p_slot  timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal_id uuid;
  v_status text;
  v_proposed_slots jsonb;
  v_showing_id uuid;
  v_org uuid;
  v_property_id uuid;
  v_lead_id uuid;
  v_old_slot timestamptz;
  v_outcome text;
  v_cancel_token uuid;
  -- Slot-validation locals, kept in lockstep with 0148 book_public_showing.
  v_slot_min integer;
  v_lead_hours integer;
  v_horizon integer;
  v_tz text;
  v_local timestamp;
  v_dow integer;
  v_min_of_day integer;
  v_override_count integer;
  -- Clustering locals (S400).
  v_cluster_enabled boolean;
  v_cluster_buffer integer;
  v_cluster_cap integer;
  v_building text;
  v_anchor_count integer;
  v_anchor_min timestamptz;
  v_anchor_max timestamptz;
  -- Return payload locals.
  v_addr text;
  v_rent integer;
  v_org_name text;
  v_brand text;
  v_brand_secondary text;
  v_logo text;
  v_reply_to text;
  v_renter_name text;
  v_renter_email text;
  v_renter_phone text;
begin
  select rp.id, rp.status, rp.proposed_slots,
         s.id, s.organization_id, s.property_id, s.lead_id,
         s.scheduled_at, s.outcome, s.cancel_token
    into v_proposal_id, v_status, v_proposed_slots,
         v_showing_id, v_org, v_property_id, v_lead_id,
         v_old_slot, v_outcome, v_cancel_token
  from public.showing_reschedule_proposals rp
  join public.showings s on s.id = rp.showing_id
  where rp.token = p_token
  for update of rp, s;

  if v_proposal_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  if v_outcome is not null and v_outcome <> 'scheduled' then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  if not exists (
    select 1
    from jsonb_array_elements_text(v_proposed_slots) as proposed(slot)
    where proposed.slot::timestamptz = p_slot
  ) then
    return jsonb_build_object('ok', false, 'reason', 'slot_not_proposed');
  end if;

  -- The unit must still be live (same gate as book_public_showing).
  if not exists (
    select 1 from public.properties
    where id = v_property_id and status = 'available'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'listing_unavailable');
  end if;

  if p_slot <= now() then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  -- ----------------------------------------------------------------------
  -- Server-side slot validation (mirrors 0148 book_public_showing).
  -- Precedence: day off > override > weekly rule.
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

  if p_slot < now() + make_interval(hours => coalesce(v_lead_hours, 0)) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  if p_slot > now() + make_interval(days => coalesce(nullif(v_horizon, 0), 14) + 1) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  v_local      := p_slot at time zone coalesce(v_tz, 'America/Toronto');
  v_dow        := extract(dow from v_local)::int;
  v_min_of_day := (extract(hour from v_local)::int) * 60
                  + extract(minute from v_local)::int;

  if extract(second from v_local)::int <> 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  if exists (
    select 1
    from public.availability_days_off d
    where d.organization_id = v_org
      and d.day = (v_local)::date
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  select count(*) into v_override_count
  from public.availability_overrides v
  where v.organization_id = v_org
    and v.day = (v_local)::date;

  if coalesce(v_override_count, 0) > 0 then
    if not exists (
      select 1
      from public.availability_overrides v
      where v.organization_id = v_org
        and v.day = (v_local)::date
        and v_min_of_day >= v.start_minute
        and v_min_of_day + v_slot_min <= v.end_minute
        and ((v_min_of_day - v.start_minute) % v_slot_min) = 0
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_available');
    end if;
  elsif not exists (
    select 1
    from public.availability_rules a
    where a.organization_id = v_org
      and a.weekday = v_dow
      and v_min_of_day >= a.start_minute
      and v_min_of_day + v_slot_min <= a.end_minute
      and ((v_min_of_day - a.start_minute) % v_slot_min) = 0
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  if exists (
    select 1
    from public.showings s
    where s.organization_id = v_org
      and s.id <> v_showing_id
      and s.scheduled_at = p_slot
      and (s.outcome is null or s.outcome = 'scheduled')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;

  -- Showing clustering (verbatim from the 0148 booking guard, except this move
  -- is updating the existing showing rather than inserting a new one).
  if coalesce(v_cluster_enabled, false) then
    select building_key into v_building
    from public.properties where id = v_property_id;

    if v_building is not null and v_building <> '' then
      select count(*), min(s.scheduled_at), max(s.scheduled_at)
        into v_anchor_count, v_anchor_min, v_anchor_max
      from public.showings s
      join public.properties cp on cp.id = s.property_id
      where s.organization_id = v_org
        and s.id <> v_showing_id
        and cp.building_key = v_building
        and cp.status <> 'off_market'
        and s.outcome = 'scheduled'
        and s.scheduled_at >= now()
        and (s.scheduled_at at time zone coalesce(v_tz, 'America/Toronto'))::date
            = (v_local)::date;

      if coalesce(v_anchor_count, 0) > 0 then
        if v_anchor_count >= (case when coalesce(v_cluster_cap, 0) > 0
                                   then v_cluster_cap else 6 end) then
          return jsonb_build_object('ok', false, 'reason', 'not_available');
        end if;
        if p_slot < v_anchor_min - make_interval(mins => greatest(0, coalesce(v_cluster_buffer, 60)))
           or p_slot > v_anchor_max + make_interval(mins => greatest(0, coalesce(v_cluster_buffer, 60))) then
          return jsonb_build_object('ok', false, 'reason', 'not_available');
        end if;
      end if;
    end if;
  end if;

  update public.showings
     set scheduled_at = p_slot,
         reminder_24h_sent_at = null,
         reminder_2h_sent_at = null,
         reminder_24h_sms_sent_at = null,
         reminder_2h_sms_sent_at = null,
         feedback_request_sent_at = null,
         outcome_nudge_sent_at = null,
         confirmation_nudge_sent_at = null,
         confirmed_at = null,
         confirmed_by = null
   where id = v_showing_id
     and organization_id = v_org
     and (outcome is null or outcome = 'scheduled');

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  update public.showing_reschedule_proposals
     set status = 'accepted', chosen_slot = p_slot, responded_at = now()
   where id = v_proposal_id and status = 'pending';

  if v_lead_id is not null then
    insert into public.messages (organization_id, lead_id, channel, direction, body)
    values (
      v_org,
      v_lead_id,
      'note',
      'inbound',
      'Renter accepted a suggested viewing time: '
        || to_char(p_slot at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC.'
    );
  end if;

  select p.address, p.rent_cents, o.name, o.brand_color, o.brand_color_secondary,
         o.logo_url, o.reply_to_email, o.booking_timezone,
         l.name, l.email, l.phone
    into v_addr, v_rent, v_org_name, v_brand, v_brand_secondary,
         v_logo, v_reply_to, v_tz,
         v_renter_name, v_renter_email, v_renter_phone
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  left join public.leads l on l.id = v_lead_id
  where p.id = v_property_id;

  return jsonb_build_object(
    'ok',                    true,
    'proposal_id',           v_proposal_id,
    'showing_id',            v_showing_id,
    'cancel_token',          v_cancel_token,
    'organization_id',       v_org,
    'lead_id',               v_lead_id,
    'property_id',           v_property_id,
    'scheduled_at',          p_slot,
    'old_scheduled_at',      v_old_slot,
    'timezone',              v_tz,
    'org_name',              v_org_name,
    'brand_color',           v_brand,
    'brand_color_secondary', v_brand_secondary,
    'logo_url',              v_logo,
    'reply_to_email',        v_reply_to,
    'property_address',      v_addr,
    'rent_cents',            v_rent,
    'renter_name',           v_renter_name,
    'renter_email',          v_renter_email,
    'renter_phone',          v_renter_phone
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  when others then
    return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

grant execute on function public.accept_reschedule_proposal(uuid, timestamptz)
  to anon, authenticated;
