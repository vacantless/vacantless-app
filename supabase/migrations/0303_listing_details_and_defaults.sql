-- S808: listing details from Agile's vacancy schedule, and account/building
-- defaults for the building-wide ones (PLAN-S807-LISTING-FIELDS-AND-LIFECYCLE).
-- Unit columns are nullable and additive. Defaults are null = not set (org) /
-- your usual (building). The app merges them in lib/policy-profile
-- resolveEffectiveFeatures; get_org_listing_feed applies the same rule here.
-- get_public_listing does not return these fields (the public page reads them
-- with lib/policy-profile), so it is unchanged.

alter table public.properties
  add column if not exists renovated_year integer check (renovated_year between 1900 and 2100),
  add column if not exists nearby text check (char_length(nearby) <= 120),
  add column if not exists exposure text[] check (exposure <@ array['north','south','east','west']::text[]),
  add column if not exists exposure_view text check (char_length(exposure_view) <= 80),
  add column if not exists parking_fee_cents integer check (parking_fee_cents between 0 and 10000000),
  add column if not exists appliances text[] check (appliances <@ array['fridge','stove','microwave','washer','dryer']::text[]),
  add column if not exists flooring text check (flooring in ('hardwood','laminate','vinyl','carpet','tile','concrete')),
  add column if not exists max_occupants integer check (max_occupants between 1 and 20);

alter table public.organizations
  add column if not exists policy_parking_type text,
  add column if not exists policy_parking_count integer check (policy_parking_count between 0 and 20),
  add column if not exists policy_parking_fee_cents integer check (policy_parking_fee_cents between 0 and 10000000),
  add column if not exists policy_laundry text check (policy_laundry in ('in_suite','in_building','shared','none')),
  add column if not exists policy_heating_type text,
  add column if not exists policy_internet_included boolean,
  add column if not exists policy_building_amenities text[],
  add column if not exists policy_nearby text check (char_length(policy_nearby) <= 120),
  add column if not exists policy_appliances text[] check (policy_appliances <@ array['fridge','stove','microwave','washer','dryer']::text[]);

alter table public.org_building_policies
  add column if not exists policy_parking_type text,
  add column if not exists policy_parking_count integer check (policy_parking_count between 0 and 20),
  add column if not exists policy_parking_fee_cents integer check (policy_parking_fee_cents between 0 and 10000000),
  add column if not exists policy_laundry text check (policy_laundry in ('in_suite','in_building','shared','none')),
  add column if not exists policy_heating_type text,
  add column if not exists policy_internet_included boolean,
  add column if not exists policy_building_amenities text[],
  add column if not exists policy_nearby text check (char_length(policy_nearby) <= 120),
  add column if not exists policy_appliances text[] check (policy_appliances <@ array['fridge','stove','microwave','washer','dryer']::text[]);

-- The syndication feed: same merge as lib/policy-profile (unit > building > org).
-- Parking type and count come as a pair only when the unit says nothing about
-- parking; the fee follows when the unit's parking is the default's kind (or
-- unset) and is not "none"; building amenities are added to the unit's own.
create or replace function public.get_org_listing_feed(p_org_slug text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
          'id',                      p.id,
          'address',                 p.address,
          'rent_cents',              p.rent_cents,
          'beds',                    p.beds,
          'baths',                   p.baths,
          'parking',                 p.parking,
          'description',             p.description,
          'available_date',          p.available_date,
          'sqft',                    p.sqft,
          'floor',                   p.floor,
          'unit_type',               p.unit_type,
          'for_rent_by',             p.for_rent_by,
          'structure_type',          p.structure_type,
          'laundry',                 coalesce(p.laundry, bp.policy_laundry, o.policy_laundry),
          'air_conditioning',        p.air_conditioning,
          'balcony',                 p.balcony,
          'furnished',               p.furnished,
          'pets_cats',               coalesce(p.pets_cats, bp.policy_pets_cats, o.policy_pets_cats, false),
          'pets_dogs',               coalesce(p.pets_dogs, bp.policy_pets_dogs, o.policy_pets_dogs, false),
          'pet_friendly',            (coalesce(p.pets_cats, bp.policy_pets_cats, o.policy_pets_cats, false)
                                      or coalesce(p.pets_dogs, bp.policy_pets_dogs, o.policy_pets_dogs, false)),
          'pets_dog_size',           coalesce(p.pets_dog_size, bp.policy_pets_dog_size, o.policy_pets_dog_size),
          'pets_notes',              p.pets_notes,
          'heat_included',           coalesce(p.heat_included,  bp.policy_heat_included,  o.policy_heat_included,  false),
          'hydro_included',          coalesce(p.hydro_included, bp.policy_hydro_included, o.policy_hydro_included, false),
          'water_included',          coalesce(p.water_included, bp.policy_water_included, o.policy_water_included, false),
          'internet_included',       coalesce(p.internet_included, bp.policy_internet_included, o.policy_internet_included),
          'cable_included',          p.cable_included,
          'amenities',               (select case when count(*) = 0 then null else array_agg(distinct a order by a) end
                                        from unnest(coalesce(p.amenities, '{}'::text[])
                                                    || coalesce(nullif(bp.policy_building_amenities, '{}'::text[]), o.policy_building_amenities, '{}'::text[])) a),
          'parking_type',            pk.ptype,
          'parking_count',           pk.pcount,
          'parking_fee_cents',       coalesce(p.parking_fee_cents,
                                       case when pk.ptype is distinct from 'none'
                                             and (p.parking_type is null or p.parking_type = pk.dtype)
                                            then pk.dfee end),
          'heating_type',            coalesce(p.heating_type, bp.policy_heating_type, o.policy_heating_type),
          'security_deposit_cents',  p.security_deposit_cents,
          'income_requirement',      p.income_requirement,
          'video_url',               p.video_url,
          'latitude',                p.latitude,
          'longitude',               p.longitude,
          'virtual_tour_url',        p.virtual_tour_url,
          'renovated_year',          p.renovated_year,
          'nearby',                  coalesce(nullif(btrim(p.nearby), ''), bp.policy_nearby, o.policy_nearby),
          'exposure',                p.exposure,
          'exposure_view',           p.exposure_view,
          'appliances',              coalesce(nullif(p.appliances, '{}'::text[]), nullif(bp.policy_appliances, '{}'::text[]), o.policy_appliances),
          'flooring',                p.flooring,
          'max_occupants',           p.max_occupants,
          'lease_term',              coalesce(p.lease_term,         bp.policy_lease_term,         o.policy_lease_term),
          'smoking',                 coalesce(p.smoking,            bp.policy_smoking,            o.policy_smoking),
          'ac_type',                 coalesce(p.ac_type,            bp.policy_ac_type,            o.policy_ac_type),
          'on_site_management',      coalesce(p.on_site_management, bp.policy_on_site_management, o.policy_on_site_management),
          'photos',                  coalesce((
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
      cross join lateral (
        select
          coalesce(bp.policy_parking_type, o.policy_parking_type) as dtype,
          coalesce(bp.policy_parking_fee_cents, o.policy_parking_fee_cents) as dfee,
          case when p.parking_type is not null or p.parking_count is not null or nullif(btrim(p.parking), '') is not null
               then p.parking_type else coalesce(bp.policy_parking_type, o.policy_parking_type) end as ptype,
          case when p.parking_type is not null or p.parking_count is not null or nullif(btrim(p.parking), '') is not null
               then p.parking_count else coalesce(bp.policy_parking_count, o.policy_parking_count) end as pcount
      ) pk
      where p.organization_id = o.id
        and p.status = 'available'
    ), '[]'::jsonb)
  )
  from public.organizations o
  where o.slug = p_org_slug;
$function$;
