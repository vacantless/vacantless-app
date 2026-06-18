-- ============================================================================
-- 0043_listing_feed — the leasing-WEDGE syndication feed (the moat vs free
-- Tenon10, whose teardown confirmed it has NO front-of-funnel).
--
-- Migration 0013 deliberately deferred "per-portal listing-distribution /
-- source-tracking links … to a syndication feature, not this data pass." This
-- is that feature's data layer: one machine-readable feed per org that a rental
-- aggregator (Rentsync / Zumper / PadMapper) ingests. The same single feed is
-- the ONLY sanctioned route back onto FB Marketplace rentals (Meta killed
-- third-party rental catalog feeds in 2021; an approved partner like Zumper is
-- the door) — see project_vacantless_syndication_strategy.
--
-- Two additive pieces, no destructive change:
--   1. organizations.public_contact_phone + public_contact_email — a rental
--      aggregator REQUIRES a contact phone per feed/account (Rentsync "Zumper &
--      PadMapper" requirements). The org had no public phone field; email falls
--      back to reply_to_email in the builder.
--   2. get_org_listing_feed(p_org_slug) — anon-callable, SECURITY DEFINER (so
--      the unauthenticated aggregator crawler reads it without any table grant
--      to anon; RLS still protects every base table). Returns the org's contact
--      block + an array of its ACTIVE listings, mirroring get_public_listing's
--      field set + photo aggregation. Only status='available' syndicates;
--      draft/paused/leased/off_market never appear. NULL when the slug is
--      unknown (the route 404s).
--
-- Mirrors the create-or-replace RPC discipline + anon grant pattern from
-- 0002/0019 (get_public_listing) and the additive-column style from 0013.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Public syndication contact fields (nullable; an aggregator requirement).
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists public_contact_phone text,
  add column if not exists public_contact_email text;

comment on column public.organizations.public_contact_phone is
  'Public contact phone published in the syndication feed (get_org_listing_feed). Required by Zumper/PadMapper. Free-text (operator-entered); no normalization.';
comment on column public.organizations.public_contact_email is
  'Public contact email for the syndication feed; falls back to reply_to_email in the feed builder when null.';

-- ---------------------------------------------------------------------------
-- 2. get_org_listing_feed — anon-safe org feed payload (org contact + active
--    listings). SECURITY DEFINER + search_path pinned, same as get_public_listing.
--    Returns NULL for an unknown slug so the route can 404.
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
  from public.organizations o
  where o.slug = p_org_slug;
$$;

comment on function public.get_org_listing_feed(text) is
  'Anon-safe syndication feed payload for an org by slug: {org:{name,slug,contact_phone,contact_email}, listings:[…active properties with photos…]}. Only status=available listings. NULL when the slug is unknown. Mirrors get_public_listing field set; SECURITY DEFINER so anon needs no table grant.';

grant execute on function public.get_org_listing_feed(text) to anon, authenticated;
