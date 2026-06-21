-- ============================================================================
-- 0050_utilities_pets_inheritance — STANDARD-POLICY profile slice 2b. Extends
-- the building/org standard-policy inheritance (0048 org defaults, 0049
-- per-building override) to the EXISTING per-unit feature booleans that are
-- building-constant in practice: included utilities (heat / hydro / water) and
-- the pet policy (cats / dogs / dog-size). Resolution stays unit > building >
-- org, identical to the four 0048/0049 policy fields.
--
-- Why this is a SEPARATE slice from 0048/0049: those four fields were brand-new
-- and nullable-from-birth, so null unambiguously meant "inherit". These feature
-- columns predate the profile and are NOT NULL DEFAULT false, so "operator never
-- set it" reads identically to a deliberate "no" (the false-vs-unset trap,
-- KI430). Naively defaulting a profile over a stored false would clobber a real
-- "tenant pays" / "no dogs". The fix (spec §6 option 1, adapted): make these
-- columns NULLABLE so null = inherit, and DROP their DEFAULT so a NEW unit
-- (addProperty inserts only address/rent/beds/baths) is born inheriting. An
-- ALTER never rewrites existing rows, so every CURRENT unit keeps its explicit
-- true/false and inherits NOTHING retroactively — i.e. ZERO behavior change on
-- deploy. Inheritance only begins once the operator sets a building/org profile
-- AND a unit is left (or set back) to inherit.
--
-- The pet_friendly MASTER (= cats OR dogs, read by S240 screening) becomes a
-- RESOLVED read in every server-side reader: get_public_listing,
-- get_org_listing_feed, AND submit_public_lead now derive it from the resolved
-- cats/dogs (coalesce unit > building > org) instead of the stored column, so an
-- inheriting unit screens against its EFFECTIVE pet policy. The stored
-- pet_friendly column is kept (written best-effort by the app) but is no longer
-- authoritative for these reads.
--
-- Four additive pieces, no destructive change:
--   1. properties: drop NOT NULL + DEFAULT on heat/hydro/water/pets_cats/
--      pets_dogs/pet_friendly (null = inherit). pets_dog_size is already
--      nullable; its null now ALSO means inherit (explicit "no size limit" is
--      the 'any' value).
--   2. organizations: org-level default columns for the six fields (nullable).
--   3. org_building_policies: the same six columns (nullable = inherit org).
--   4. Recreate get_public_listing + get_org_listing_feed + submit_public_lead
--      to resolve the six fields (+ pet_friendly) coalesce(unit, building, org).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Make the legacy per-unit feature booleans nullable + drop their default.
--    null = inherit the building/org profile. DROP NOT NULL / DROP DEFAULT on an
--    already-nullable / default-less column is a no-op, so this is safe to rerun.
-- ---------------------------------------------------------------------------
alter table public.properties alter column heat_included   drop default;
alter table public.properties alter column heat_included   drop not null;
alter table public.properties alter column hydro_included  drop default;
alter table public.properties alter column hydro_included  drop not null;
alter table public.properties alter column water_included  drop default;
alter table public.properties alter column water_included  drop not null;
alter table public.properties alter column pets_cats       drop default;
alter table public.properties alter column pets_cats       drop not null;
alter table public.properties alter column pets_dogs       drop default;
alter table public.properties alter column pets_dogs       drop not null;
alter table public.properties alter column pet_friendly    drop default;
alter table public.properties alter column pet_friendly    drop not null;

comment on column public.properties.heat_included is
  'Heat included in rent. null = inherit the building/org standard policy (0050). A set true/false is this unit''s own value.';
comment on column public.properties.hydro_included is
  'Hydro included in rent. null = inherit the building/org standard policy (0050).';
comment on column public.properties.water_included is
  'Water included in rent. null = inherit the building/org standard policy (0050).';
comment on column public.properties.pets_cats is
  'Cats welcome. null = inherit the building/org standard policy (0050). pet_friendly master = (resolved cats OR resolved dogs).';
comment on column public.properties.pets_dogs is
  'Dogs welcome. null = inherit the building/org standard policy (0050).';
comment on column public.properties.pets_dog_size is
  'Dog size limit (small|medium|large|any). null = inherit (0050); explicit no-limit is the ''any'' value.';

-- ---------------------------------------------------------------------------
-- 2. Org-level defaults for the six fields. All nullable = no org default yet.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists policy_heat_included  boolean,
  add column if not exists policy_hydro_included boolean,
  add column if not exists policy_water_included boolean,
  add column if not exists policy_pets_cats      boolean,
  add column if not exists policy_pets_dogs      boolean,
  add column if not exists policy_pets_dog_size  text;

comment on column public.organizations.policy_heat_included is
  'Org-level STANDARD: heat included in rent, inherited by every unit unless the unit (or its building) overrides it. null = no default set.';
comment on column public.organizations.policy_pets_cats is
  'Org-level STANDARD: cats welcome. null = no default set.';
comment on column public.organizations.policy_pets_dog_size is
  'Org-level STANDARD dog size limit (small|medium|large|any), applies when dogs are welcome. null = no default set.';

-- ---------------------------------------------------------------------------
-- 3. Per-building defaults (org_building_policies). null = inherit the org.
-- ---------------------------------------------------------------------------
alter table public.org_building_policies
  add column if not exists policy_heat_included  boolean,
  add column if not exists policy_hydro_included boolean,
  add column if not exists policy_water_included boolean,
  add column if not exists policy_pets_cats      boolean,
  add column if not exists policy_pets_dogs      boolean,
  add column if not exists policy_pets_dog_size  text;

comment on column public.org_building_policies.policy_pets_dog_size is
  'Per-building dog size limit (small|medium|large|any). null = inherit the org default.';

-- dog-size enum guards (mirror the 0048/0049 DO-block pattern).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_policy_pets_dog_size_chk') then
    alter table public.organizations add constraint organizations_policy_pets_dog_size_chk
      check (policy_pets_dog_size is null or policy_pets_dog_size in ('small','medium','large','any'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_building_policies_pets_dog_size_chk') then
    alter table public.org_building_policies add constraint org_building_policies_pets_dog_size_chk
      check (policy_pets_dog_size is null or policy_pets_dog_size in ('small','medium','large','any'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4a. get_public_listing — recreated from 0049 with the six utilities/pets
--     fields (+ pet_friendly) now resolved coalesce(unit, building, org). The
--     bp LEFT JOIN already exists for the four 0048/0049 policy fields.
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
    'pets_cats',        coalesce(p.pets_cats, bp.policy_pets_cats, o.policy_pets_cats, false),
    'pets_dogs',        coalesce(p.pets_dogs, bp.policy_pets_dogs, o.policy_pets_dogs, false),
    'pet_friendly',     (coalesce(p.pets_cats, bp.policy_pets_cats, o.policy_pets_cats, false)
                          or coalesce(p.pets_dogs, bp.policy_pets_dogs, o.policy_pets_dogs, false)),
    'pets_dog_size',    coalesce(p.pets_dog_size, bp.policy_pets_dog_size, o.policy_pets_dog_size),
    'pets_notes',       p.pets_notes,
    'heat_included',    coalesce(p.heat_included,  bp.policy_heat_included,  o.policy_heat_included,  false),
    'hydro_included',   coalesce(p.hydro_included, bp.policy_hydro_included, o.policy_hydro_included, false),
    'water_included',   coalesce(p.water_included, bp.policy_water_included, o.policy_water_included, false),
    'virtual_tour_url', p.virtual_tour_url,
    'lease_term',         coalesce(p.lease_term,         bp.policy_lease_term,         o.policy_lease_term),
    'smoking',            coalesce(p.smoking,            bp.policy_smoking,            o.policy_smoking),
    'ac_type',            coalesce(p.ac_type,            bp.policy_ac_type,            o.policy_ac_type),
    'on_site_management', coalesce(p.on_site_management, bp.policy_on_site_management, o.policy_on_site_management),
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
  left join public.org_building_policies bp
    on bp.organization_id = p.organization_id
   and bp.building_key = p.building_key
  where p.id = p_property_id
    and p.status not in ('off_market', 'draft');
$$;

grant execute on function public.get_public_listing(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4b. get_org_listing_feed — same resolution per listing.
-- ---------------------------------------------------------------------------
create or replace function public.get_org_listing_feed(p_org_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'org', jsonb_build_object(
      'name',          o.name,
      'slug',          o.slug,
      'contact_phone', o.public_contact_phone,
      'contact_email', coalesce(o.public_contact_email, o.reply_to_email)
    ),
    'listings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',               p.id,
          'address',          p.address,
          'rent_cents',       p.rent_cents,
          'beds',             p.beds,
          'baths',            p.baths,
          'parking',          p.parking,
          'description',      p.description,
          'available_date',   p.available_date,
          'sqft',             p.sqft,
          'floor',            p.floor,
          'laundry',          p.laundry,
          'air_conditioning', p.air_conditioning,
          'balcony',          p.balcony,
          'furnished',        p.furnished,
          'pets_cats',        coalesce(p.pets_cats, bp.policy_pets_cats, o.policy_pets_cats, false),
          'pets_dogs',        coalesce(p.pets_dogs, bp.policy_pets_dogs, o.policy_pets_dogs, false),
          'pet_friendly',     (coalesce(p.pets_cats, bp.policy_pets_cats, o.policy_pets_cats, false)
                                or coalesce(p.pets_dogs, bp.policy_pets_dogs, o.policy_pets_dogs, false)),
          'pets_dog_size',    coalesce(p.pets_dog_size, bp.policy_pets_dog_size, o.policy_pets_dog_size),
          'pets_notes',       p.pets_notes,
          'heat_included',    coalesce(p.heat_included,  bp.policy_heat_included,  o.policy_heat_included,  false),
          'hydro_included',   coalesce(p.hydro_included, bp.policy_hydro_included, o.policy_hydro_included, false),
          'water_included',   coalesce(p.water_included, bp.policy_water_included, o.policy_water_included, false),
          'virtual_tour_url', p.virtual_tour_url,
          'lease_term',         coalesce(p.lease_term,         bp.policy_lease_term,         o.policy_lease_term),
          'smoking',            coalesce(p.smoking,            bp.policy_smoking,            o.policy_smoking),
          'ac_type',            coalesce(p.ac_type,            bp.policy_ac_type,            o.policy_ac_type),
          'on_site_management', coalesce(p.on_site_management, bp.policy_on_site_management, o.policy_on_site_management),
          'photos',           coalesce((
            select jsonb_agg(ph.url order by ph.is_cover desc, ph.sort_order asc, ph.created_at asc)
            from public.property_photos ph
            where ph.property_id = p.id
          ), '[]'::jsonb)
        )
        order by p.created_at desc
      )
      from public.properties p
      left join public.org_building_policies bp
        on bp.organization_id = p.organization_id
       and bp.building_key = p.building_key
      where p.organization_id = o.id
        and p.status = 'available'
    ), '[]'::jsonb)
  )
  from public.organizations o
  where o.slug = p_org_slug;
$$;

grant execute on function public.get_org_listing_feed(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4c. submit_public_lead — recreated from 0046 (operator-tunable reason copy).
--     ONLY change vs 0046: a LEFT JOIN org_building_policies bp on
--     (org, p.building_key), and v_pet_ok is now the RESOLVED pet_friendly
--     (coalesce unit > building > org) instead of the stored p.pet_friendly, so
--     S240 pet screening evaluates the unit's EFFECTIVE pet policy. Everything
--     else is byte-identical. Same 11-arg signature -> plain CREATE OR REPLACE.
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
  select p.organization_id, p.address, p.rent_cents,
         -- RESOLVED pet_friendly (unit > building > org), 0050.
         (coalesce(p.pets_cats, bp.policy_pets_cats, o.policy_pets_cats, false)
           or coalesce(p.pets_dogs, bp.policy_pets_dogs, o.policy_pets_dogs, false)),
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
  left join public.org_building_policies bp
    on bp.organization_id = p.organization_id
   and bp.building_key = p.building_key
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

    -- Pets: has pets, unit is not pet-friendly (resolved policy).
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
