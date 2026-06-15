-- ============================================================================
-- Vacantless — M3: native booking (availability + self-serve slot booking)
-- ============================================================================
-- Adds:
--   * organizations.booking_*          — per-org booking config (timezone, slot
--     length, lead time, horizon).
--   * availability_rules               — weekly recurring availability windows,
--     org-scoped, RLS keyed to organization_id (one window = weekday + a local
--     start/end minute-of-day; times are in the org's booking_timezone).
--   * showings_org_slot_unique         — a partial unique index so two
--     'scheduled' showings can never land on the same org + timestamp
--     (the integrity guard against a double-booking race).
--   * get_public_availability(uuid)    — SECURITY DEFINER, anon. Returns the
--     org's booking config + availability rules + already-booked future slots
--     for a listing, so the public page can generate open slots client/server-
--     side WITHOUT any table read grant to anon (RLS still protects every base
--     table). Slot generation itself happens in TS (lib/booking.ts) because it
--     needs IANA-timezone-aware wall-clock math.
--   * book_public_showing(...)         — SECURITY DEFINER, anon. Books a slot
--     against a just-created lead (recency-guarded like record_auto_reply),
--     creates the showing, advances the lead to 'booked', logs the timeline.
--     The unique index is the real double-booking guard.
--   * record_booking_email(...)        — NEW, anon-safe, logs the booking
--     confirmation email to the lead timeline.
--
-- Run once after 0003. M1 base-table RLS untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Per-org booking configuration.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists booking_timezone     text    not null default 'America/Toronto',
  add column if not exists booking_slot_minutes  integer not null default 30,
  add column if not exists booking_lead_hours    integer not null default 12,
  add column if not exists booking_horizon_days  integer not null default 14;

-- ---------------------------------------------------------------------------
-- Weekly recurring availability windows. weekday: 0=Sunday .. 6=Saturday.
-- start_minute / end_minute = minutes from local midnight in booking_timezone.
-- ---------------------------------------------------------------------------
create table if not exists public.availability_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  weekday         smallint not null check (weekday between 0 and 6),
  start_minute    integer  not null check (start_minute between 0 and 1440),
  end_minute      integer  not null check (end_minute between 0 and 1440),
  created_at      timestamptz not null default now(),
  check (end_minute > start_minute)
);

create index if not exists idx_availability_org
  on public.availability_rules (organization_id);

alter table public.availability_rules enable row level security;

drop policy if exists availability_all on public.availability_rules;
create policy availability_all on public.availability_rules
  for all
  using (organization_id in (select user_org_ids()))
  with check (organization_id in (select user_org_ids()));

-- ---------------------------------------------------------------------------
-- One 'scheduled' showing per org + timestamp (double-booking guard).
-- Cancelled / completed showings are excluded so a freed slot can rebook.
-- ---------------------------------------------------------------------------
create unique index if not exists showings_org_slot_unique
  on public.showings (organization_id, scheduled_at)
  where outcome = 'scheduled';

-- ---------------------------------------------------------------------------
-- Public read: a listing's booking config + availability + booked slots.
-- Anon-safe. Returns NULL when the property is missing or off market.
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
    ), '[]'::jsonb)
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id
    and p.status <> 'off_market';
$$;

grant execute on function public.get_public_availability(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public write: book a slot for a just-created lead. Anon-safe + recency-
-- guarded. The unique index enforces no double-booking; window validity is
-- additionally checked in the TS action before this is called.
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
  v_renter_name text;
  v_renter_email text;
begin
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

  select p.address, o.name, o.brand_color, o.logo_url, o.booking_timezone
    into v_addr, v_org_name, v_brand, v_logo, v_tz
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

-- ---------------------------------------------------------------------------
-- Log a booking confirmation email to the lead timeline (anon-safe).
-- ---------------------------------------------------------------------------
create or replace function public.record_booking_email(
  p_lead_id uuid,
  p_to      text,
  p_subject text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from public.leads
  where id = p_lead_id
    and created_at > now() - interval '20 minutes';

  if v_org is null then
    return;  -- silently no-op: stale or missing lead
  end if;

  insert into public.messages
    (organization_id, lead_id, channel, direction, body)
  values
    (v_org, p_lead_id, 'email', 'outbound',
     'Booking confirmation sent'
       || case when p_to is not null then ' to ' || p_to else '' end
       || case when p_subject is not null then ' — "' || p_subject || '"' else '' end);
end;
$$;

grant execute on function public.record_booking_email(uuid, text, text)
  to anon, authenticated;
