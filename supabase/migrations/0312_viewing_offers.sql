-- 0312_viewing_offers.sql
-- S823c: the landlord offers a renter 1 to 3 viewing times by hand; the renter
-- taps one and it is booked. No calendar is shown and no viewing window has to
-- be open: the landlord picked these times personally, so accept does NOT run
-- the availability checks that book_public_showing runs. The only gates are
-- that the time was really offered, is still ahead, the rental is still
-- available, and nobody else holds that time (showings_org_slot_unique).
-- Rule 431: grants for the new table are in this file, service_role included.

create table if not exists public.viewing_offers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id         uuid not null references public.leads(id) on delete cascade,
  property_id     uuid not null references public.properties(id) on delete cascade,
  proposed_slots  jsonb not null
                    check (jsonb_typeof(proposed_slots) = 'array'
                           and jsonb_array_length(proposed_slots) between 1 and 3),
  token           uuid not null default gen_random_uuid(),
  status          text not null default 'pending'
                    check (status in ('pending','accepted','expired','withdrawn')),
  chosen_slot     timestamptz,
  showing_id      uuid references public.showings(id) on delete set null,
  created_at      timestamptz not null default now(),
  responded_at    timestamptz,
  unique (token)
);

create unique index if not exists uq_viewing_offer_pending_per_lead
  on public.viewing_offers (lead_id) where status = 'pending';
create index if not exists idx_viewing_offers_org
  on public.viewing_offers (organization_id, created_at desc);

alter table public.viewing_offers enable row level security;

drop policy if exists viewing_offers_all on public.viewing_offers;
create policy viewing_offers_all on public.viewing_offers
  for all
  using (organization_id in (select user_org_ids()))
  with check (organization_id in (select user_org_ids()));

grant select, insert, update, delete on public.viewing_offers to authenticated;
grant select, insert, update, delete on public.viewing_offers to service_role;

-- Read by token (the renter's link). Renders only; never writes.
create or replace function public.get_viewing_offer(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_payload jsonb;
begin
  select vo.status,
         jsonb_build_object(
           'ok',                    true,
           'status',                vo.status,
           'proposed_slots',        vo.proposed_slots,
           'chosen_slot',           vo.chosen_slot,
           'property_id',           p.id,
           'property_address',      p.address,
           'property_status',       p.status,
           'org_name',              o.name,
           'brand_color',           o.brand_color,
           'brand_color_secondary', o.brand_color_secondary,
           'logo_url',              o.logo_url,
           'timezone',              o.booking_timezone,
           'renter_name',           l.name
         )
    into v_status, v_payload
  from public.viewing_offers vo
  join public.properties p on p.id = vo.property_id
  join public.organizations o on o.id = vo.organization_id
  join public.leads l on l.id = vo.lead_id
  where vo.token = p_token;

  if v_payload is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_status not in ('pending', 'accepted') then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  return v_payload;
end;
$$;

revoke all on function public.get_viewing_offer(uuid) from public;
grant execute on function public.get_viewing_offer(uuid) to anon, authenticated, service_role;

-- The renter's tap. Books the viewing as confirmed.
create or replace function public.accept_viewing_offer(
  p_token uuid,
  p_slot  timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer_id uuid;
  v_status text;
  v_slots jsonb;
  v_org uuid;
  v_lead uuid;
  v_property uuid;
  v_showing uuid;
  v_cancel uuid;
  v_tz text;
  v_org_name text;
  v_brand text;
  v_logo text;
  v_alias text;
  v_reply_to text;
  v_addr text;
  v_renter_name text;
  v_renter_email text;
  v_renter_phone text;
begin
  select vo.id, vo.status, vo.proposed_slots, vo.organization_id, vo.lead_id, vo.property_id
    into v_offer_id, v_status, v_slots, v_org, v_lead, v_property
  from public.viewing_offers vo
  where vo.token = p_token
  for update of vo;

  if v_offer_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;
  if not exists (
    select 1 from jsonb_array_elements_text(v_slots) as proposed(slot)
    where proposed.slot::timestamptz = p_slot
  ) then
    return jsonb_build_object('ok', false, 'reason', 'slot_not_proposed');
  end if;
  if p_slot <= now() then
    return jsonb_build_object('ok', false, 'reason', 'past');
  end if;
  if not exists (
    select 1 from public.properties where id = v_property and status = 'available'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'listing_unavailable');
  end if;

  begin
    insert into public.showings
      (organization_id, lead_id, property_id, scheduled_at, outcome, confirmed_at, confirmed_by)
    values
      (v_org, v_lead, v_property, p_slot, 'scheduled', now(), 'renter')
    returning id, cancel_token into v_showing, v_cancel;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end;

  update public.viewing_offers
     set status = 'accepted', chosen_slot = p_slot, showing_id = v_showing, responded_at = now()
   where id = v_offer_id;

  update public.leads
     set status = 'booked'
   where id = v_lead and status in ('new', 'replied', 'contacted', 'booked', 'lost');

  select o.booking_timezone, o.name, o.brand_color, o.logo_url, o.mail_alias, o.reply_to_email
    into v_tz, v_org_name, v_brand, v_logo, v_alias, v_reply_to
  from public.organizations o where o.id = v_org;
  select p.address into v_addr from public.properties p where p.id = v_property;
  select l.name, l.email, l.phone into v_renter_name, v_renter_email, v_renter_phone
  from public.leads l where l.id = v_lead;

  insert into public.messages (organization_id, lead_id, channel, direction, body)
  values (
    v_org, v_lead, 'note', 'inbound',
    'The renter picked ' ||
      trim(to_char(p_slot at time zone coalesce(v_tz, 'America/Toronto'), 'FMDay, FMMonth FMDD')) ||
      ' at ' ||
      trim(to_char(p_slot at time zone coalesce(v_tz, 'America/Toronto'), 'FMHH12:MI AM')) ||
      ' from the times you offered. The viewing is booked.'
  );

  return jsonb_build_object(
    'ok',               true,
    'organization_id',  v_org,
    'lead_id',          v_lead,
    'property_id',      v_property,
    'showing_id',       v_showing,
    'cancel_token',     v_cancel,
    'scheduled_at',     p_slot,
    'timezone',         v_tz,
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'logo_url',         v_logo,
    'mail_alias',       v_alias,
    'reply_to_email',   v_reply_to,
    'property_address', v_addr,
    'renter_name',      v_renter_name,
    'renter_email',     v_renter_email,
    'renter_phone',     v_renter_phone
  );
end;
$$;

revoke all on function public.accept_viewing_offer(uuid, timestamptz) from public;
grant execute on function public.accept_viewing_offer(uuid, timestamptz) to anon, authenticated, service_role;
