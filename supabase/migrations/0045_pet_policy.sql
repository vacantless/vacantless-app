-- ============================================================================
-- 0045_pet_policy — upgrade the single pet_friendly boolean to a STRUCTURED pet
-- policy (cats / dogs / dog-size limit / notes).
--
-- Why: a binary "pet friendly" can't say WHAT is welcome. A renter with a cat
-- and a building that takes cats-but-not-dogs both lose information. Structured
-- pet data (1) enriches the public listing + the syndication feed (Zumper /
-- PadMapper map pet detail), and (2) keeps the pet_friendly MASTER — which the
-- S240 pre-screening reads (screening_flag_pets vs an explicitly not-pet-
-- friendly unit) — consistent, because the app now DERIVES pet_friendly =
-- (cats OR dogs). One source of truth, no "pet friendly checked but nothing
-- actually allowed" contradiction.
--
-- RTA note: pet policy is an ADVERTISING / screening field, never an enforceable
-- lease clause (Residential Tenancies Act s.14 voids "no pets" clauses). These
-- columns describe what the unit ADVERTISES, not what a signed lease forbids.
--
-- Three additive pieces, no destructive change:
--   1. properties: pets_cats / pets_dogs (bool) + pets_dog_size (text, checked)
--      + pets_notes (text). pet_friendly is KEPT (the derived master the RPCs
--      and screening already read).
--   2. Backfill: an existing pet_friendly=true unit becomes cats+dogs welcome
--      (a safe superset the operator can narrow); pet_friendly=false stays none.
--   3. Recreate the two READ RPCs (get_public_listing, get_org_listing_feed) —
--      same signatures, CREATE OR REPLACE, byte-for-byte their 0044/0043 bodies
--      plus the four new fields. submit_public_lead is deliberately UNCHANGED:
--      screening still reads the pet_friendly master (no new RPC overload).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Structured pet columns (additive; nullable text, default-false booleans).
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists pets_cats     boolean not null default false,
  add column if not exists pets_dogs     boolean not null default false,
  add column if not exists pets_dog_size text,
  add column if not exists pets_notes    text;

comment on column public.properties.pets_cats is
  'Advertised pet policy: cats welcome. The pet_friendly master = (pets_cats OR pets_dogs), derived in the app on write.';
comment on column public.properties.pets_dogs is
  'Advertised pet policy: dogs welcome.';
comment on column public.properties.pets_dog_size is
  'Optional dog size limit when dogs are welcome: small | medium | large | any (null = unspecified). RTA: an advertising field, not a lease clause.';
comment on column public.properties.pets_notes is
  'Optional free-text pet notes for the listing (e.g. "1 pet max, no aggressive breeds").';

-- Guard the size enum (no "add constraint if not exists" in Postgres -> DO block).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'properties_pets_dog_size_chk'
  ) then
    alter table public.properties
      add constraint properties_pets_dog_size_chk
      check (pets_dog_size is null or pets_dog_size in ('small','medium','large','any'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill from the legacy boolean (safe superset). Idempotent: only flips
--    rows that are pet_friendly but not yet structured.
-- ---------------------------------------------------------------------------
update public.properties
  set pets_cats = true,
      pets_dogs = true
  where pet_friendly = true
    and pets_cats = false
    and pets_dogs = false;

-- ---------------------------------------------------------------------------
-- 3a. get_public_listing — same signature + the four new fields. CREATE OR
--     REPLACE (no drop); byte-for-byte the 0044 body with pets_* added.
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
-- 3b. get_org_listing_feed — same signature + the four new fields. CREATE OR
--     REPLACE; byte-for-byte the 0043 body with pets_* added per listing.
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
