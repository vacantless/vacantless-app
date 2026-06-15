-- ============================================================================
-- Vacantless — M4: customer-set reply-to address
-- ============================================================================
-- Adds a per-org reply-to email so renter replies to the automated emails
-- (inquiry auto-reply, booking confirmation, showing reminder) route to the
-- customer's own inbox instead of the shared leads@vacantless.com.
--
--   * organizations.reply_to_email  — NEW nullable text. NULL means "use the
--     default" (leads@vacantless.com); the app falls back when it's unset.
--     Validated app-side (lib/branding.ts) before it's ever written here, so
--     the public RPCs below just pass the stored value straight through.
--
--   * submit_public_lead(...)        — REPLACED (same args + jsonb return). Adds
--     reply_to_email to the auto-reply payload.
--   * book_public_showing(...)       — REPLACED (same args + jsonb return). Adds
--     reply_to_email to the booking-confirmation payload.
--
-- The showing-reminder sweep reads the org row directly via the service-role
-- client (app/api/cron/reminders), so it needs no RPC change — just a column
-- to select. Both functions are anon-callable SECURITY DEFINER; the new field
-- is the org's own configured value, never another tenant's.
--
-- Additive + idempotent. Run once after 0007. M1 base-table RLS untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Per-org reply-to address. NULL = fall back to the default sender.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists reply_to_email text;

-- ---------------------------------------------------------------------------
-- submit_public_lead: add reply_to_email to the auto-reply payload.
-- Return type is unchanged (jsonb) so a plain CREATE OR REPLACE is enough.
-- ---------------------------------------------------------------------------
create or replace function public.submit_public_lead(
  p_property_id uuid,
  p_name        text,
  p_email       text,
  p_phone       text,
  p_move_in     date,
  p_notes       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_lead     uuid;
  v_addr     text;
  v_rent     integer;
  v_org_name text;
  v_brand    text;
  v_logo     text;
  v_reply_to text;
  v_tpl_subj text;
  v_tpl_body text;
begin
  select p.organization_id, p.address, p.rent_cents,
         o.name, o.brand_color, o.logo_url, o.reply_to_email
    into v_org, v_addr, v_rent, v_org_name, v_brand, v_logo, v_reply_to
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id and p.status <> 'off_market';

  if v_org is null then
    raise exception 'Listing not available';
  end if;

  insert into public.leads
    (organization_id, property_id, name, email, phone, move_in, source, status, notes)
  values
    (v_org, p_property_id,
     nullif(btrim(p_name), ''),
     nullif(btrim(p_email), ''),
     nullif(btrim(p_phone), ''),
     p_move_in,
     'website', 'new',
     nullif(btrim(p_notes), ''))
  returning id into v_lead;

  -- Inbound activity note for the timeline (unchanged behaviour).
  insert into public.messages
    (organization_id, lead_id, channel, direction, body)
  values
    (v_org, v_lead, 'note', 'inbound',
     'New inquiry via the public listing page'
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

grant execute on function public.submit_public_lead(uuid, text, text, text, date, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- book_public_showing: add reply_to_email to the booking-confirmation payload.
-- Return type unchanged (jsonb) so CREATE OR REPLACE is enough.
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
