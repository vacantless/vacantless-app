-- ============================================================================
-- 0168_public_browse_listings - public, browse-safe cross-org rental inventory.
--
-- This is the walled-garden public browse data layer for /rentals and
-- /rentals/[city]. It mirrors the cross-org shape and ACTIVE listing WHERE from
-- 0110_network_listing_feed, but deliberately returns only ad-safe listing
-- fields plus the org display name. No org slug, contact phone/email, tokens, or
-- private routing identifiers are exposed.
--
-- Readiness remains in the app layer via lib/listing-feed.listingFeedReadiness:
-- the RPC returns active inventory, and the public browse surface filters to
-- browse-ready cards before rendering.
-- ============================================================================

create or replace function public.get_public_browse_listings()
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
          'name', o.name
        ),
        'listings', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id',               p.id,
              'address',          p.address,
              'rent_cents',       p.rent_cents,
              'beds',             p.beds,
              'baths',            p.baths,
              'sqft',             p.sqft,
              'floor',            p.floor,
              'laundry',          p.laundry,
              'parking',          p.parking,
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
              'available_date',   p.available_date,
              'description',      p.description,
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

comment on function public.get_public_browse_listings() is
  'Public browse-safe cross-org rental payload: a jsonb array of {org:{name},listings} for every org with >=1 active listing. Exposes only ad-safe listing fields; no org slug, contact fields, or tokens. SECURITY DEFINER; search_path pinned. Execute is granted to anon and authenticated for the dark-gated /rentals browse surface.';

-- create-or-replace defaults execute to PUBLIC; lock it to explicit app roles.
revoke all on function public.get_public_browse_listings() from public;
revoke all on function public.get_public_browse_listings() from anon;
revoke all on function public.get_public_browse_listings() from authenticated;
grant execute on function public.get_public_browse_listings() to anon;
grant execute on function public.get_public_browse_listings() to authenticated;
