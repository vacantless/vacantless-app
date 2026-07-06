-- ============================================================================
-- 0110_network_listing_feed - the CROSS-ORG aggregate syndication feed.
--
-- The per-org feed (0043 get_org_listing_feed) lets one landlord hand a portal
-- their own listings. But the big Canadian/US portals gate on VOLUME (Zumper's
-- custom feed wants 50+ properties; Rentsync leans multifamily), which a single
-- small landlord can't clear. The platform lever is to present EVERY customer's
-- active listings as ONE feed, the reason a small landlord is better off on
-- Vacantless than going direct. This is that feed's data layer.
--
-- get_network_listing_feed() returns a jsonb ARRAY of the same per-org payload
-- shape 0043 already produces ({org:{…}, listings:[…]}), one element per org
-- that has at least one ACTIVE (status='available') listing. The pure builder
-- (lib/listing-feed.buildNetworkFeedXml) wraps each in a <provider> block with
-- that org's own contact, reusing the per-listing builder + readiness so the
-- network feed can never drift from the per-org feed.
--
-- SECURITY: unlike get_org_listing_feed (anon-callable, one public org at a
-- time), this returns EVERY customer's inventory in one shot, which is
-- sensitive. So it is SECURITY DEFINER but execute is granted ONLY to
-- service_role (never anon / authenticated). The serving route
-- (app/api/feed/network) is additionally
-- token-gated and reads via the service-role admin client, so the whole surface
-- is dark until a partner is handed the URL + NETWORK_FEED_TOKEN. No data
-- change, no new column; additive read-only function only.
-- ============================================================================

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
              'heat_included',    p.heat_included,
              'hydro_included',   p.hydro_included,
              'water_included',   p.water_included,
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

comment on function public.get_network_listing_feed() is
  'Cross-org aggregate syndication payload: a jsonb array of {org,listings} (same shape as get_org_listing_feed) for every org with >=1 active listing. Returns every customer inventory, so execute is granted ONLY to service_role; the app/api/feed/network route is additionally token-gated. SECURITY DEFINER; search_path pinned.';

-- create-or-replace defaults execute to PUBLIC; lock it down to service_role.
revoke all on function public.get_network_listing_feed() from public;
revoke all on function public.get_network_listing_feed() from anon;
revoke all on function public.get_network_listing_feed() from authenticated;
grant execute on function public.get_network_listing_feed() to service_role;
