-- ===========================================================================
-- 0046_screening_reason_copy — operator-tunable qualify-out reason copy (S257)
--
-- A screening follow-on to 0044. An operator may override the wording shown on a
-- flagged inquiry per criterion (income / move-in / pets) to match their voice;
-- a NULL/blank override falls back to the canonical default string. Only the
-- operator ever sees these labels — renters never do.
--
-- Purely additive + zero behavior change when unset: every existing org keeps
-- NULL for all three columns, so submit_public_lead produces the exact same
-- default reason strings it did under 0044. Mirrors lib/screening.ts
-- (resolveScreeningReason) byte-for-byte (the anon-RPC-re-validate rule). The
-- resolved wording is SNAPSHOT into the lead at intake — same as the rest of the
-- qualify-out result — so editing the copy later never rewrites an old lead.
-- ===========================================================================

-- 1) Org-level custom reason copy --------------------------------------------
alter table public.organizations
  add column if not exists screening_reason_income text,
  add column if not exists screening_reason_movein text,
  add column if not exists screening_reason_pets   text;

comment on column public.organizations.screening_reason_income is
  'Operator-custom wording for the income qualify-out reason. null/blank = default.';
comment on column public.organizations.screening_reason_movein is
  'Operator-custom wording for the move-in-timing qualify-out reason. null/blank = default.';
comment on column public.organizations.screening_reason_pets is
  'Operator-custom wording for the pets qualify-out reason. null/blank = default.';

-- 2) submit_public_lead — read the custom copy and coalesce it into the
--    snapshot. SAME 11-arg signature as 0044, so a plain CREATE OR REPLACE (no
--    drop). Body is byte-identical to 0044 except: 3 new declares, 3 new SELECT
--    targets, and the 3 reason appends now coalesce the org override over the
--    canonical default.
-- ---------------------------------------------------------------------------
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
  v_rsn_income text;
  v_rsn_movein text;
  v_rsn_pets   text;
  v_reasons    text[] := '{}'::text[];
  v_qualout    boolean := false;
begin
  select p.organization_id, p.address, p.rent_cents, p.pet_friendly,
         o.name, o.brand_color, o.logo_url, o.reply_to_email,
         o.screening_enabled, o.screening_income_multiple,
         o.screening_max_movein_days, o.screening_flag_pets,
         o.screening_reason_income, o.screening_reason_movein,
         o.screening_reason_pets
    into v_org, v_addr, v_rent, v_pet_ok,
         v_org_name, v_brand, v_logo, v_reply_to,
         v_scr_on, v_scr_mult, v_scr_days, v_scr_pets,
         v_rsn_income, v_rsn_movein, v_rsn_pets
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
  -- runs when the org opted in; missing answers never cause a flag. The reason
  -- wording is the org override coalesced over the canonical default
  -- (resolveScreeningReason) and is snapshotted into the lead.
  if v_scr_on then
    -- Income: monthly income below (multiple x monthly rent).
    if v_scr_mult is not null and v_scr_mult > 0
       and p_income_cents is not null
       and v_rent is not null and v_rent > 0
       and p_income_cents < v_scr_mult * v_rent then
      v_reasons := array_append(
        v_reasons,
        coalesce(nullif(btrim(v_rsn_income), ''), 'Income below your requirement'));
    end if;

    -- Move-in timing: desired move-in further out than the configured window.
    if v_scr_days is not null and p_move_in is not null
       and (p_move_in - current_date) > v_scr_days then
      v_reasons := array_append(
        v_reasons,
        coalesce(nullif(btrim(v_rsn_movein), ''), 'Move-in later than your window'));
    end if;

    -- Pets: has pets, unit is not pet-friendly.
    if coalesce(v_scr_pets, true) and not coalesce(v_pet_ok, false)
       and p_has_pets is true then
      v_reasons := array_append(
        v_reasons,
        coalesce(nullif(btrim(v_rsn_pets), ''), 'Has pets; rental is not pet-friendly'));
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
