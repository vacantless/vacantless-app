-- ============================================================================
-- 0206_property_channel_fields - channel-aware property fields (S614 Lane A)
--
-- Adds nullable, additive listing fields that let the app distinguish what a
-- property page, syndication feed, and classifieds channels need without
-- repurposing existing free-text fields. This does not change RLS, does not
-- backfill data, and does not remove or rename properties.parking.
--
-- Lane A is schema + read payload only. Operator UI, write-path wiring, env
-- flips, feed partner rollout, and migration application remain separate gates.
-- ============================================================================

alter table public.properties
  add column if not exists internet_included boolean,
  add column if not exists cable_included boolean,
  add column if not exists amenities text[],
  add column if not exists parking_type text,
  add column if not exists parking_count integer,
  add column if not exists heating_type text,
  add column if not exists security_deposit_cents integer,
  add column if not exists income_requirement text,
  add column if not exists video_url text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

comment on column public.properties.internet_included is
  'Whether internet is included in rent. Nullable so unset means unknown/not captured; app validation owns the vocabulary and presentation.';
comment on column public.properties.cable_included is
  'Whether cable TV is included in rent. Nullable so unset means unknown/not captured.';
comment on column public.properties.amenities is
  'Canonical amenity keys for channel feeds and readiness checks. App enum owns accepted values; nullable/additive.';
comment on column public.properties.parking_type is
  'Structured parking type for channel feeds. Existing properties.parking free text remains intact and is still preserved.';
comment on column public.properties.parking_count is
  'Structured parking count for channel feeds. Nullable when unknown or not applicable.';
comment on column public.properties.heating_type is
  'Structured heating type for channel readiness and future feed/display use. App enum owns accepted values.';
comment on column public.properties.security_deposit_cents is
  'Optional security deposit in integer cents for channels that request deposit information.';
comment on column public.properties.income_requirement is
  'Optional income/application requirement text for channels that request qualification notes.';
comment on column public.properties.video_url is
  'Optional listing video URL, distinct from virtual_tour_url. App validators decide what can be emitted.';
comment on column public.properties.latitude is
  'Optional latitude for channel/location readiness. Nullable; no geocoding is performed by this migration.';
comment on column public.properties.longitude is
  'Optional longitude for channel/location readiness. Nullable; no geocoding is performed by this migration.';

-- ---------------------------------------------------------------------------
-- get_org_listing_feed - include existing unit/structure type and the new
-- channel-aware fields so lib/listing-feed can compute per-listing output once
-- this migration is intentionally applied.
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
          'laundry',                 p.laundry,
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
          'internet_included',       p.internet_included,
          'cable_included',          p.cable_included,
          'amenities',               p.amenities,
          'parking_type',            p.parking_type,
          'parking_count',           p.parking_count,
          'heating_type',            p.heating_type,
          'security_deposit_cents',  p.security_deposit_cents,
          'income_requirement',      p.income_requirement,
          'video_url',               p.video_url,
          'latitude',                p.latitude,
          'longitude',               p.longitude,
          'virtual_tour_url',        p.virtual_tour_url,
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
      where p.organization_id = o.id
        and p.status = 'available'
    ), '[]'::jsonb)
  )
  from public.organizations o
  where o.slug = p_org_slug;
$$;

grant execute on function public.get_org_listing_feed(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_network_listing_feed - keep the network feed shape aligned with the
-- per-org feed. This function remains service_role-only and token-gated at the
-- route; no public execute grants are added.
-- ---------------------------------------------------------------------------
create or replace function public.get_network_listing_feed()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
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
              'laundry',                 p.laundry,
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
              'internet_included',       p.internet_included,
              'cable_included',          p.cable_included,
              'amenities',               p.amenities,
              'parking_type',            p.parking_type,
              'parking_count',           p.parking_count,
              'heating_type',            p.heating_type,
              'security_deposit_cents',  p.security_deposit_cents,
              'income_requirement',      p.income_requirement,
              'video_url',               p.video_url,
              'latitude',                p.latitude,
              'longitude',               p.longitude,
              'virtual_tour_url',        p.virtual_tour_url,
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
          where p.organization_id = o.id
            and p.status = 'available'
        ), '[]'::jsonb)
      )
      order by o.name asc
    ),
    '[]'::jsonb
  )
  from public.organizations o
  where exists (
    select 1 from public.properties p
    where p.organization_id = o.id
      and p.status = 'available'
  );
$$;

comment on function public.get_network_listing_feed() is
  'Cross-org aggregate syndication payload aligned with get_org_listing_feed, including channel-aware property fields. Returns every customer inventory, so execute is granted ONLY to service_role; the app/api/feed/network route is additionally token-gated. SECURITY DEFINER; search_path pinned.';

revoke all on function public.get_network_listing_feed() from public;
revoke all on function public.get_network_listing_feed() from anon;
revoke all on function public.get_network_listing_feed() from authenticated;
grant execute on function public.get_network_listing_feed() to service_role;
