-- ===========================================================================
-- 0044_lead_screening — candidate pre-screening (S240, the leasing wedge)
--
-- Captures a few structured qualifying answers on the public inquiry and stamps
-- an auto "qualify-out" flag (+ human reasons) at intake, so the operator can
-- triage which inquiries are unlikely to fit before spending time on them. It
-- is a SOFT signal — it never rejects a renter or hides a lead.
--
-- Purely additive + default-OFF: every existing org keeps `screening_enabled =
-- false`, so the public form is unchanged and no lead is ever flagged until an
-- operator opts in from Settings. Mirrors lib/screening.ts evaluateScreening
-- byte-for-byte (the anon-RPC-re-validate rule); qualified_out + reasons are a
-- SNAPSHOT at intake so later criteria changes never rewrite an old lead.
--
-- Fair-housing: the criteria are limited to legitimate, non-protected business
-- factors (income vs rent, move-in timing, pet match against a not-pet-friendly
-- unit). Occupant count is captured for context but NEVER drives a qualify-out.
-- ===========================================================================

-- 1) Org-level screening configuration ---------------------------------------
alter table public.organizations
  add column if not exists screening_enabled        boolean not null default false,
  add column if not exists screening_income_multiple numeric(4,2),
  add column if not exists screening_max_movein_days integer,
  add column if not exists screening_flag_pets       boolean not null default true;

comment on column public.organizations.screening_income_multiple is
  'Require renter monthly income >= this multiple of monthly rent (e.g. 3.00). null = do not screen on income.';
comment on column public.organizations.screening_max_movein_days is
  'Flag inquiries whose desired move-in is more than this many days out. null = do not screen on move-in timing.';

-- 2) Lead-level screening answers + computed flag ----------------------------
alter table public.leads
  add column if not exists screen_income_cents  integer,
  add column if not exists screen_occupants     integer,
  add column if not exists screen_has_pets      boolean,
  add column if not exists screen_pets_detail   text,
  add column if not exists qualified_out        boolean not null default false,
  add column if not exists qualify_out_reasons  text[]  not null default '{}'::text[];

-- 3) get_public_listing — expose screening_enabled so the public renter page
--    knows whether to render the qualifying questions. Same signature, so a
--    plain CREATE OR REPLACE (no drop). Byte-for-byte the 0027 body + one field.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_listing(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',               p.id,
    'address',          p.address,
    'rent_cents',       p.rent_cents,
    'beds',             p.beds,
    'baths',            p.baths,
    'parking',          p.parking,
    'description',      p.description,
    'status',           p.status,
    'available_date',   p.available_date,
    'sqft',             p.sqft,
    'floor',            p.floor,
    'laundry',          p.laundry,
    'air_conditioning', p.air_conditioning,
    'balcony',          p.balcony,
    'furnished',        p.furnished,
    'pet_friendly',     p.pet_friendly,
    'heat_included',    p.heat_included,
    'hydro_included',   p.hydro_included,
    'water_included',   p.water_included,
    'org_name',         o.name,
    'brand_color',      o.brand_color,
    'brand_color_secondary', o.brand_color_secondary,
    'logo_url',         o.logo_url,
    'screening_enabled', o.screening_enabled,
    'photos',           coalesce((
      select jsonb_agg(ph.url order by ph.is_cover desc, ph.sort_order asc, ph.created_at asc)
      from public.property_photos ph
      where ph.property_id = p.id
    ), '[]'::jsonb)
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id
    and p.status not in ('off_market', 'draft');
$$;

grant execute on function public.get_public_listing(uuid) to anon, authenticated;

-- 4) submit_public_lead — accept the screening answers, store them, and compute
--    the qualify-out snapshot. The new params are appended with defaults so the
--    arg count changes -> this is a NEW overload; drop the old one first so
--    PostgREST resolves a single function (no ambiguity).
-- ---------------------------------------------------------------------------
drop function if exists public.submit_public_lead(uuid, text, text, text, date, text, uuid);

create or replace function public.submit_public_lead(
  p_property_id     uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_move_in         date,
  p_notes           text,
  p_listing_post_id uuid    default null,
  p_income_cents    integer default null,
  p_occupants       integer default null,
  p_has_pets        boolean default null,
  p_pets_detail     text    default null
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
  v_pet_ok     boolean;
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
  -- screening config + computed result
  v_scr_on     boolean;
  v_scr_mult   numeric;
  v_scr_days   integer;
  v_scr_pets   boolean;
  v_reasons    text[] := '{}'::text[];
  v_qualout    boolean := false;
begin
  select p.organization_id, p.address, p.rent_cents, p.pet_friendly,
         o.name, o.brand_color, o.logo_url, o.reply_to_email,
         o.screening_enabled, o.screening_income_multiple,
         o.screening_max_movein_days, o.screening_flag_pets
    into v_org, v_addr, v_rent, v_pet_ok,
         v_org_name, v_brand, v_logo, v_reply_to,
         v_scr_on, v_scr_mult, v_scr_days, v_scr_pets
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

  -- Candidate pre-screening (mirrors lib/screening.ts evaluateScreening). Only
  -- runs when the org opted in; missing answers never cause a flag.
  if v_scr_on then
    -- Income: monthly income below (multiple x monthly rent).
    if v_scr_mult is not null and v_scr_mult > 0
       and p_income_cents is not null
       and v_rent is not null and v_rent > 0
       and p_income_cents < v_scr_mult * v_rent then
      v_reasons := array_append(v_reasons, 'Income below your requirement');
    end if;

    -- Move-in timing: desired move-in further out than the configured window.
    if v_scr_days is not null and p_move_in is not null
       and (p_move_in - current_date) > v_scr_days then
      v_reasons := array_append(v_reasons, 'Move-in later than your window');
    end if;

    -- Pets: has pets, unit is not pet-friendly.
    if coalesce(v_scr_pets, true) and not coalesce(v_pet_ok, false)
       and p_has_pets is true then
      v_reasons := array_append(v_reasons, 'Has pets; rental is not pet-friendly');
    end if;

    v_qualout := array_length(v_reasons, 1) is not null;
  end if;

  insert into public.leads
    (organization_id, property_id, name, email, phone, move_in,
     source, source_detail, listing_post_id, status, notes,
     sms_opt_out, sms_opt_out_at,
     screen_income_cents, screen_occupants, screen_has_pets, screen_pets_detail,
     qualified_out, qualify_out_reasons)
  values
    (v_org, p_property_id,
     nullif(btrim(p_name), ''),
     nullif(btrim(p_email), ''),
     nullif(btrim(p_phone), ''),
     p_move_in,
     v_source, v_source_det, v_post, 'new',
     nullif(btrim(p_notes), ''),
     v_optout,
     case when v_optout then now() else null end,
     p_income_cents,
     p_occupants,
     p_has_pets,
     nullif(btrim(p_pets_detail), ''),
     v_qualout,
     v_reasons)
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
  public.submit_public_lead(uuid, text, text, text, date, text, uuid, integer, integer, boolean, text)
  to anon, authenticated;
