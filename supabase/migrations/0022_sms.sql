-- 0022_sms.sql
-- Phase B: optional Twilio SMS layer for the two renter-facing, no-show-reducing
-- transactional moments — the booking confirmation and the 24h / 2h showing
-- reminders. SMS mirrors the existing Brevo email senders: per-org opt-in,
-- renter-consent-based (the renter gave their number on the inquiry form), and
-- best-effort (it degrades to a no-op until the Twilio credentials are set in
-- Vercel). Nothing here is required for the app to run.
--
-- Columns added:
--   organizations.sms_enabled            -> per-org master switch (default false;
--                                           off until creds + the operator opts in)
--   leads.sms_opt_out / sms_opt_out_at   -> per-renter suppression set by an
--                                           inbound STOP (the /api/sms/inbound
--                                           webhook writes these via service role)
--   showings.reminder_24h_sms_sent_at    -> idempotency stamps for the SMS
--   showings.reminder_2h_sms_sent_at        reminders, INDEPENDENT of the email
--                                           reminder_*_sent_at stamps so email and
--                                           SMS each send (and never double-send)
--                                           on their own track.
--
-- No new GRANT: organizations/leads/showings are already granted to
-- authenticated (RLS-scoped) and to service_role (0007); ADD COLUMN inherits the
-- table grant (see KEY_INSIGHTS 324). The webhook + crons write via the
-- service-role admin client; the owner reads through the normal own-org RLS.

-- 1) Org master switch -------------------------------------------------------
alter table public.organizations
  add column if not exists sms_enabled boolean not null default false;

comment on column public.organizations.sms_enabled is
  'Per-org SMS master switch. When false (default) no SMS is ever sent. Turned on by the operator in Settings once Twilio creds are live and they want renter texts.';

-- 2) Per-renter opt-out (STOP) ----------------------------------------------
alter table public.leads
  add column if not exists sms_opt_out boolean not null default false,
  add column if not exists sms_opt_out_at timestamptz;

comment on column public.leads.sms_opt_out is
  'True once this renter texted STOP (set by /api/sms/inbound). No SMS is sent to an opted-out lead even if the org has SMS on.';

create index if not exists leads_sms_opt_out_idx
  on public.leads (organization_id, phone)
  where sms_opt_out;

-- 3) SMS reminder idempotency stamps (separate from the email stamps) --------
alter table public.showings
  add column if not exists reminder_24h_sms_sent_at timestamptz,
  add column if not exists reminder_2h_sms_sent_at timestamptz;

comment on column public.showings.reminder_24h_sms_sent_at is
  'When the 24h reminder SMS was sent (idempotency; independent of reminder_24h_sent_at which tracks the email).';
comment on column public.showings.reminder_2h_sms_sent_at is
  'When the 2h reminder SMS was sent (idempotency; independent of reminder_2h_sent_at which tracks the email).';

-- 4) book_public_showing: add renter_phone + sms_enabled to the booking payload
-- so the public booking action can fire a best-effort confirmation SMS. Body is
-- the 0018 version (status='available' re-check intact); signature + return type
-- (jsonb) unchanged, so create-or-replace is sufficient (no DROP / re-grant).
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
begin
  -- The unit must still be live (closes the lease-mid-inquiry edge case).
  if not exists (
    select 1 from public.properties
    where id = p_property_id and status = 'available'
  ) then
    raise exception 'Listing not available';
  end if;

  -- Lead must belong to the property's org and be freshly created.
  select l.organization_id, l.name, l.email, l.phone
    into v_org, v_renter_name, v_renter_email, v_renter_phone
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

grant execute on function public.book_public_showing(uuid, uuid, timestamptz)
  to anon, authenticated;

-- 5) record_booking_sms — definer logger so the anon public booking action can
-- record the confirmation SMS on the lead timeline (mirrors record_booking_email;
-- the action runs unauthenticated and can't insert into messages under RLS).
create or replace function public.record_booking_sms(
  p_lead_id uuid,
  p_to      text
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
    (v_org, p_lead_id, 'sms', 'outbound',
     'Booking confirmation text sent'
       || case when p_to is not null then ' to ' || p_to else '' end);
end;
$$;

grant execute on function public.record_booking_sms(uuid, text)
  to anon, authenticated;
