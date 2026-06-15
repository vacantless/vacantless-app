-- ============================================================================
-- Vacantless — Unit-level property fields
-- ============================================================================
-- Deepens the property data model from address/rent/beds/baths/parking to a
-- complete renter-facing unit profile, so a listing reads the way a real rental
-- ad does (availability, size, amenities, what's included). This is the core
-- "Vacantless vision" depth pass.
--
-- All columns land on public.properties, which is already RLS-protected and
-- already granted to the app roles at the table level (the M1 grants carry no
-- column list, so they extend to columns added here). No new grant needed.
--
-- Renter-facing (surfaced through get_public_listing → the public /r page):
--   * available_date    date     — when the unit is available (NULL = "now").
--   * sqft              integer  — interior square footage.
--   * floor             text     — free text ("2nd", "Ground", "Basement").
--   * laundry           text     — in_suite | in_building | shared | none.
--   * air_conditioning  boolean  — has A/C.
--   * balcony           boolean  — has a private balcony / outdoor space.
--   * furnished         boolean  — comes furnished.
--   * pet_friendly      boolean  — pets allowed.
--   * heat_included     boolean  — heat included in rent.
--   * hydro_included    boolean  — hydro / electricity included in rent.
--   * water_included    boolean  — water included in rent.
--
-- Operator-internal (NOT public — workflow flag only):
--   * photos_ready      boolean  — listing photos are shot + ready (ties to the
--                                  "never post with < 5 photos" operator policy).
--
-- Deliberately deferred to a later, separate surface (per the portal-refinement
-- backlog "explicitly NOT now"): per-portal listing-distribution / source-
-- tracking links. Those belong to a syndication feature, not this data pass.
-- ============================================================================

alter table public.properties
  add column if not exists available_date   date,
  add column if not exists sqft             integer,
  add column if not exists floor            text,
  add column if not exists laundry          text
    check (laundry is null or laundry in ('in_suite', 'in_building', 'shared', 'none')),
  add column if not exists air_conditioning boolean not null default false,
  add column if not exists balcony          boolean not null default false,
  add column if not exists furnished        boolean not null default false,
  add column if not exists pet_friendly     boolean not null default false,
  add column if not exists heat_included    boolean not null default false,
  add column if not exists hydro_included   boolean not null default false,
  add column if not exists water_included   boolean not null default false,
  add column if not exists photos_ready     boolean not null default false;

-- ---------------------------------------------------------------------------
-- Public read: extend the anon-safe listing RPC with the new renter-facing
-- fields so the public /r page can render availability + amenities + what's
-- included. photos_ready is intentionally excluded (operator-internal).
-- Still SECURITY DEFINER, still hides off-market units, no table grant to anon.
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
    'logo_url',         o.logo_url
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id
    and p.status <> 'off_market';
$$;

grant execute on function public.get_public_listing(uuid) to anon, authenticated;
