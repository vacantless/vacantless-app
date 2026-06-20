-- ============================================================================
-- 0047_virtual_tour_url — add a nullable listing tour / video LINK field
-- (REAL-WORLD-INTAKE item S, S265).
--
-- Why: a realtor's MLS data sheet / realtor.ca page carries a virtual-tour URL
-- (an iGUIDE 3D tour, a Matterport scan, or a YouTube/Vimeo video) that
-- realtor.ca shows but Vacantless had nowhere to store. One nullable column lets
-- the unit carry that link so the public /r page can EMBED it and the fill sheet
-- + syndication feed can ride it to the portals. Captured three ways (manual
-- paste, MLS-sheet extraction, later the sibling video engine); the app + the
-- lib/virtual-tour allow-list decide whether a given URL is an embeddable tour.
--
-- Two additive pieces, no destructive change:
--   1. properties.virtual_tour_url (text, nullable). No CHECK constraint — the
--      host allow-list lives in lib/virtual-tour (a DB regex would duplicate it
--      and drift); the write path validates before storing.
--   2. Recreate the two READ RPCs (get_public_listing, get_org_listing_feed) —
--      same signatures, CREATE OR REPLACE, byte-for-byte their 0045 bodies plus
--      the one new field. submit_public_lead is UNCHANGED.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The column (additive, nullable text).
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists virtual_tour_url text;

comment on column public.properties.virtual_tour_url is
  'Listing virtual tour / video URL (iGUIDE / Matterport / YouTube / Vimeo). Nullable. Validated against the lib/virtual-tour host allow-list on write; embedded on the public /r page and carried to the fill sheet + syndication feed.';

-- ---------------------------------------------------------------------------
-- 2a. get_public_listing — same signature + the one new field. CREATE OR
--     REPLACE (no drop); byte-for-byte the 0045 body with virtual_tour_url added.
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
    'pets_cats',        p.pets_cats,
    'pets_dogs',        p.pets_dogs,
    'pets_dog_size',    p.pets_dog_size,
    'pets_notes',       p.pets_notes,
    'heat_included',    p.heat_included,
    'hydro_included',   p.hydro_included,
    'water_included',   p.water_included,
    'virtual_tour_url', p.virtual_tour_url,
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

-- ---------------------------------------------------------------------------
-- 2b. get_org_listing_feed — same signature + the one new field per listing.
--     CREATE OR REPLACE; byte-for-byte the 0045 body with virtual_tour_url added.
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
          'pet_friendly',     p.pet_friendly,
          'pets_cats',        p.pets_cats,
          'pets_dogs',        p.pets_dogs,
          'pets_dog_size',    p.pets_dog_size,
          'pets_notes',       p.pets_notes,
          'heat_included',    p.heat_included,
          'hydro_included',   p.hydro_included,
          'water_included',   p.water_included,
          'virtual_tour_url', p.virtual_tour_url,
          'photos',           coalesce((
            select jsonb_agg(ph.url order by ph.is_cover desc, ph.sort_order asc, ph.created_at asc)
            from public.property_photos ph
            where ph.property_id = p.id
          ), '[]'::jsonb)
        )
        order by p.created_at desc
      )
      from public.properties p
      where p.organization_id = o.id
        and p.status = 'available'
    ), '[]'::jsonb)
  )
  from public.organizations o
  where o.slug = p_org_slug;
$$;

grant execute on function public.get_org_listing_feed(text) to anon, authenticated;
