-- S735: the public browse surface (/rentals, /rentals/[city], the sitemap)
-- goes live. Two things had to be true first, read from prod on 2026-10-23:
--
-- 1. Our own test organizations (Growth Test, North Star Rentals QA, Lakeview
--    Rentals, Stranger Five Rentals, S731 Founding Test) hold "available"
--    rentals that would have shown to the public. An organization now has a
--    browse_listed switch, on by default, that Settings exposes to the landlord
--    ("Show my rentals on vacantless.com") and that we turn off for our own
--    accounts here.
--
-- 2. A rental that nobody has touched for weeks is not a rental a renter should
--    find on our site. The browse RPC now shows a rental only when it is fresh:
--    a live ad on any site, an inquiry in the last 45 days, or a rental that was
--    added or became available in the last 45 days. The rental's own page (/r)
--    is unchanged; this is the index, not the page.
--
-- Closed accounts never show.

alter table public.organizations
  add column if not exists browse_listed boolean not null default true;

comment on column public.organizations.browse_listed is
  'S735: whether this organization''s available rentals appear on the public /rentals browse pages and in the sitemap. Default on; the landlord can turn it off in Settings. Off for our own test organizations.';

update public.organizations
   set browse_listed = false
 where id in (
   '8ea1da48-0cd2-45a4-bfba-023b31a67884', -- Growth Test
   'b733a191-30fd-47fe-bd21-731404148026', -- North Star Rentals QA
   'b6fdceb7-e7f6-4f54-bbab-107ae5d3254a', -- Lakeview Rentals
   '1d6a9dde-7fd7-46ac-ad36-6823dacaa2cf', -- Stranger Five Rentals
   'ad03ea5d-17ab-4b89-b030-345af1e0479d'  -- S731 Founding Test
 );

create or replace function public.get_public_browse_listings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with fresh as (
    select p.*
      from public.properties p
     where p.status = 'available'
       and (
         exists (
           select 1 from public.listing_posts lp
            where lp.property_id = p.id and lp.status = 'live'
         )
         or exists (
           select 1 from public.leads l
            where l.property_id = p.id
              and l.created_at >= now() - interval '45 days'
         )
         or p.created_at >= now() - interval '45 days'
         or (p.available_date is not null
             and p.available_date >= current_date - 45)
       )
  )
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
              'address_display_mode', p.address_display_mode,
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
          from fresh p
          where p.organization_id = o.id
        ), '[]'::jsonb)
      )
      order by o.name asc
    ),
    '[]'::jsonb
  )
  from public.organizations o
  where o.browse_listed
    and o.closed_at is null
    and exists (
      select 1 from fresh p
      where p.organization_id = o.id
    );
$$;

comment on function public.get_public_browse_listings() is
  'Anon-safe browse payload for /rentals: listed organizations (browse_listed, not closed) and their fresh available rentals (live ad, inquiry in 45 days, or added/available within 45 days). No contacts, no slugs.';

revoke all on function public.get_public_browse_listings() from public;
revoke all on function public.get_public_browse_listings() from anon;
revoke all on function public.get_public_browse_listings() from authenticated;
grant execute on function public.get_public_browse_listings() to anon;
grant execute on function public.get_public_browse_listings() to authenticated;
