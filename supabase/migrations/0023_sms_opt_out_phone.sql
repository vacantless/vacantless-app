-- 0023_sms_opt_out_phone.sql
-- Phase C QA fix (Group A) - close the two SMS opt-out compliance gaps found in
-- the 2026-06-16 audit (VACANTLESS-PHASE-C-QA-AUDIT-2026-06-16.md). Both are
-- currently harmless because SMS ships DORMANT (no Twilio creds, per-org toggle
-- off); they must be closed BEFORE the per-org SMS toggle is ever turned on.
--
--   A1  The booking-confirmation SMS ignored a prior STOP. book_public_showing
--       did not surface the renter's opt-out, AND a NEW inquiry from an
--       opted-out number was born with sms_opt_out = false, so the reminders
--       cron (which reads the lead's own sms_opt_out) would also have re-texted.
--   A2  The inbound STOP handler scanned only the first 2000 leads and matched
--       free-text phones in JS, so a STOP past the cap was silently never
--       honored (a CASL/TCPA exposure).
--
-- Root fix: a normalized E.164 column on leads (mirrors lib/sms
-- normalizePhoneE164, NANP +1 default) so opt-out is matched in SQL, plus
-- opt-out INHERITANCE at lead creation so a re-inquiring opted-out renter's new
-- lead is born suppressed. That makes leads.sms_opt_out the single source of
-- truth that BOTH the public booking action and the reminders cron already read.
--
-- No new GRANT: leads is already granted to authenticated (RLS-scoped) and to
-- service_role (0007); a generated column and a regular column inherit the table
-- grant. The webhook writes via the service-role admin client.

-- 1) Immutable E.164 normalizer (pure scalar SQL; mirrors lib/sms
--    normalizePhoneE164 exactly - verified parity over 15 cases. Pure string
--    ops on built-ins only, so it is safe + immutable for a generated column).
create or replace function public.normalize_phone_e164(raw text, default_cc text default '1')
returns text
language sql
immutable
set search_path = public
as $fn$
  select case
    when raw is null or btrim(raw) = '' then null
    when regexp_replace(btrim(raw), '[^0-9]', '', 'g') = '' then null
    when left(btrim(raw), 1) = '+' then
      case when char_length(regexp_replace(btrim(raw), '[^0-9]', '', 'g')) between 8 and 15
           then '+' || regexp_replace(btrim(raw), '[^0-9]', '', 'g') else null end
    when char_length(regexp_replace(btrim(raw), '[^0-9]', '', 'g')) = 10 then
      '+' || default_cc || regexp_replace(btrim(raw), '[^0-9]', '', 'g')
    when char_length(regexp_replace(btrim(raw), '[^0-9]', '', 'g')) = 11
         and left(regexp_replace(btrim(raw), '[^0-9]', '', 'g'), char_length(default_cc)) = default_cc then
      '+' || regexp_replace(btrim(raw), '[^0-9]', '', 'g')
    else null
  end
$fn$;

comment on function public.normalize_phone_e164(text, text) is
  'Normalize a free-text phone to E.164 (NANP +1 default), or NULL if implausible. Mirrors lib/sms.normalizePhoneE164 so SQL and TS agree. Used by the leads.phone_e164 generated column + opt-out matching.';

-- 2) Normalized phone column on leads, kept in sync automatically for EVERY
--    write path (the public intake RPC, any future dashboard-created lead).
alter table public.leads
  add column if not exists phone_e164 text
    generated always as (public.normalize_phone_e164(phone, '1'::text)) stored;

comment on column public.leads.phone_e164 is
  'Normalized E.164 form of phone (generated). Powers SQL opt-out matching (inbound STOP) + opt-out inheritance at lead creation. NULL when phone is missing/implausible.';

-- 3) Indexes: replace the old opt-out partial index (was on the free-text phone)
--    with one on phone_e164, plus a general lookup index for STOP matching +
--    creation-time inheritance.
drop index if exists public.leads_sms_opt_out_idx;
create index if not exists leads_sms_opt_out_idx
  on public.leads (phone_e164) where sms_opt_out;
create index if not exists leads_phone_e164_idx
  on public.leads (phone_e164);

-- 4) submit_public_lead: inherit a prior STOP for this number within the org so
--    a re-inquiring opted-out renter is born suppressed. Body is the 0018
--    version with the two added lines (v_optout compute + the two extra insert
--    columns); signature + return shape unchanged, so create-or-replace is
--    sufficient (no DROP / re-grant).
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
  v_optout     boolean := false;
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
  -- the plain 'website' source - it can never attach a lead to another unit.
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

  -- Inherit a prior STOP for this number in this org: if any existing lead with
  -- the same normalized phone has opted out, the new lead is born opted out so
  -- no SMS (confirmation OR reminder) is ever sent without a fresh START.
  select exists (
    select 1 from public.leads
    where organization_id = v_org
      and sms_opt_out
      and phone_e164 = public.normalize_phone_e164(p_phone, '1'::text)
  ) into v_optout;

  insert into public.leads
    (organization_id, property_id, name, email, phone, move_in,
     source, source_detail, listing_post_id, status, notes,
     sms_opt_out, sms_opt_out_at)
  values
    (v_org, p_property_id,
     nullif(btrim(p_name), ''),
     nullif(btrim(p_email), ''),
     nullif(btrim(p_phone), ''),
     p_move_in,
     v_source, v_source_det, v_post, 'new',
     nullif(btrim(p_notes), ''),
     v_optout,
     case when v_optout then now() else null end)
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

-- 5) book_public_showing: surface the renter's opt-out so the public booking
--    action can skip the confirmation SMS for an opted-out number. Body is the
--    0022 version with v_sms_opt_out added to the lead select + the return;
--    signature + return type (jsonb) unchanged, so create-or-replace suffices.
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

grant execute on function public.book_public_showing(uuid, uuid, timestamptz)
  to anon, authenticated;
