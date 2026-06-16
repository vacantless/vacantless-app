-- ============================================================================
-- Vacantless — Gate the public action RPCs on status = 'available'
-- ============================================================================
-- BUG (S192 live QA audit, code-verified): a unit marked "Leased" in the
-- dashboard still showed "Available now" on its public /r page AND still
-- accepted bookings/inquiries. Root cause: every public-facing RPC guarded
-- visibility with `status <> 'off_market'`, which BLACKLISTS one bad state
-- instead of WHITELISTING the visible one — so the MIDDLE enum value 'leased'
-- (properties.status is 'available' | 'leased' | 'off_market', see 0001_init)
-- leaked straight through the guard.
--
-- FIX: gate the three ACTION paths on `status = 'available'` so leased AND
-- off-market units are hard-blocked server-side from being booked, inquired
-- on, or returned as bookable:
--   * get_public_availability  (0016) — REPLACED: gate the listing on
--       status = 'available'. A non-available unit returns NULL → no slots.
--   * submit_public_lead       (0014) — REPLACED: gate on status = 'available'
--       → a non-available unit raises 'Listing not available' (no lead row).
--   * book_public_showing      (0008) — REPLACED: same body + an explicit
--       status = 'available' re-check, closing the in-flight edge case where a
--       unit is leased AFTER a renter inquired (their lead already exists) but
--       BEFORE they confirm the showing.
--
-- DELIBERATELY UNCHANGED: get_public_listing (0013) keeps its broader
-- `status <> 'off_market'` guard so the public /r page can still LOAD a leased
-- unit and render a clear "no longer available" state (the page reads the
-- returned `status` and suppresses the inquiry/booking form). Off-market units
-- return NULL there → 404 (fully delisted). This is the read-only DISPLAY path;
-- the security-relevant ACTION paths above are what get hard-gated. Defense in
-- depth: even a hand-crafted POST to the booking action hits the gated RPCs.
--
-- All three are SECURITY DEFINER and keep their existing signatures, so
-- CREATE OR REPLACE is sufficient (no signature change, no new grant). Run once
-- after 0017.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- get_public_availability — gate the target listing on status = 'available'.
-- (Body is byte-for-byte the 0016 version except the final WHERE guard.)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- submit_public_lead — gate the property lookup on status = 'available'.
-- (Body is byte-for-byte the 0014 version except the property WHERE guard.)
-- ---------------------------------------------------------------------------
create or replace function public.submit_public_lead(
  p_property_id     uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_move_in         date,
  p_notes           text,
  p_listing_post_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org        uuid;
  v_lead       uuid;
  v_addr       text;
  v_rent       integer;
  v_org_name   text;
  v_brand      text;
  v_logo       text;
  v_reply_to   text;
  v_tpl_subj   text;
  v_tpl_body   text;
  v_portal     text;
  v_label      text;
  v_url        text;
  v_post       uuid := null;
  v_source     text := 'website';
  v_source_det text := null;
begin
  select p.organization_id, p.address, p.rent_cents,
         o.name, o.brand_color, o.logo_url, o.reply_to_email
    into v_org, v_addr, v_rent, v_org_name, v_brand, v_logo, v_reply_to
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id and p.status = 'available';

  if v_org is null then
    raise exception 'Listing not available';
  end if;

  -- Resolve the tracked post, but only if it genuinely belongs to THIS
  -- property (and therefore this org). A bad/foreign id silently falls back to
  -- the plain 'website' source — it can never attach a lead to another unit.
  if p_listing_post_id is not null then
    select lp.id, lp.portal, lp.label, lp.url
      into v_post, v_portal, v_label, v_url
    from public.listing_posts lp
    where lp.id = p_listing_post_id
      and lp.property_id = p_property_id;

    if v_post is not null then
      v_source := case v_portal
        when 'kijiji'     then 'Kijiji'
        when 'facebook'   then 'Facebook Marketplace'
        when 'rentals_ca' then 'Rentals.ca'
        when 'zumper'     then 'Zumper'
        when 'viewit'     then 'Viewit.ca'
        when 'realtor_ca' then 'Realtor.ca'
        else coalesce(nullif(btrim(v_label), ''), 'Other portal')
      end;
      v_source_det := nullif(btrim(v_url), '');
    end if;
  end if;

  insert into public.leads
    (organization_id, property_id, name, email, phone, move_in,
     source, source_detail, listing_post_id, status, notes)
  values
    (v_org, p_property_id,
     nullif(btrim(p_name), ''),
     nullif(btrim(p_email), ''),
     nullif(btrim(p_phone), ''),
     p_move_in,
     v_source, v_source_det, v_post, 'new',
     nullif(btrim(p_notes), ''))
  returning id into v_lead;

  -- Inbound activity note for the timeline. Mentions the channel when known.
  insert into public.messages
    (organization_id, lead_id, channel, direction, body)
  values
    (v_org, v_lead, 'note', 'inbound',
     'New inquiry via '
       || case when v_post is not null then v_source else 'the public listing page' end
       || case when p_move_in is not null
               then '. Desired move-in: ' || to_char(p_move_in, 'YYYY-MM-DD')
               else '' end);

  -- Most-recent auto_reply template for this org, if the operator made one.
  select t.subject, t.body
    into v_tpl_subj, v_tpl_body
  from public.templates t
  where t.organization_id = v_org and t.kind = 'auto_reply'
  order by t.created_at desc
  limit 1;

  return jsonb_build_object(
    'lead_id',          v_lead,
    'org_id',           v_org,
    'renter_name',      nullif(btrim(p_name), ''),
    'renter_email',     nullif(btrim(p_email), ''),
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'logo_url',         v_logo,
    'reply_to_email',   v_reply_to,
    'property_address', v_addr,
    'rent_cents',       v_rent,
    'template_subject', v_tpl_subj,
    'template_body',    v_tpl_body
  );
end;
$$;

grant execute on function
  public.submit_public_lead(uuid, text, text, text, date, text, uuid)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- book_public_showing — add an explicit status = 'available' re-check so a unit
-- leased AFTER the renter inquired (lead already exists) but BEFORE they
-- confirm cannot still slip a booking through. (Body is the 0008 version with
-- the added guard; signature + return unchanged.)
-- ---------------------------------------------------------------------------
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
  v_org         uuid;
  v_show        uuid;
  v_addr        text;
  v_tz          text;
  v_org_name    text;
  v_brand       text;
  v_logo        text;
  v_reply_to    text;
  v_renter_name text;
  v_renter_email text;
begin
  -- The unit must still be live. Closes the in-flight edge case: a renter
  -- inquires while the unit is available, the operator marks it leased, then
  -- the renter confirms the showing — without this, the lead still exists and
  -- the booking would go through.
  if not exists (
    select 1 from public.properties
    where id = p_property_id and status = 'available'
  ) then
    raise exception 'Listing not available';
  end if;

  -- The lead must belong to the property's org and have been created in the
  -- last 15 minutes (the legitimate just-inquired window) — bounds abuse.
  select l.organization_id, l.name, l.email
    into v_org, v_renter_name, v_renter_email
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

  insert into public.showings
    (organization_id, lead_id, property_id, scheduled_at, outcome)
  values
    (v_org, p_lead_id, p_property_id, p_slot, 'scheduled')
  returning id into v_show;

  -- Advance the lead to booked (only from an earlier open stage).
  update public.leads
     set status = 'booked'
   where id = p_lead_id
     and status in ('new', 'replied', 'contacted');

  insert into public.messages
    (organization_id, lead_id, channel, direction, body)
  values
    (v_org, p_lead_id, 'note', 'inbound',
     'Showing booked via the public listing page for '
       || to_char(p_slot at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');

  select p.address, o.name, o.brand_color, o.logo_url, o.booking_timezone, o.reply_to_email
    into v_addr, v_org_name, v_brand, v_logo, v_tz, v_reply_to
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
    'property_address', v_addr,
    'renter_name',      v_renter_name,
    'renter_email',     v_renter_email
  );
exception
  when unique_violation then
    raise exception 'That time was just taken';
end;
$$;

grant execute on function public.book_public_showing(uuid, uuid, timestamptz)
  to anon, authenticated;
