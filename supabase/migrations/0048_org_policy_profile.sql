-- ============================================================================
-- 0048_org_policy_profile — building/org STANDARD-POLICY profile (slice 1: org
-- level). The "set it once, inherit on every unit" layer for building-constant
-- policy fields, so they aren't re-keyed per unit and per portal.
--
-- Why (the evidence): on the live Unit 20 Zumper post (S271) A/C was initially
-- wrong because the unit's flag was unset and the real value lived only in the
-- listing docs. Building-constant attributes (lease term, smoking, A/C type,
-- on-site management) get re-typed for every unit. A profile attached at the org
-- level — inherited by every unit, overridden only per-exception — removes the
-- re-keying and the class of error that bit Unit 20.
--
-- Scope (slice 1, the FOUR genuinely-new policy fields): lease_term, smoking,
-- ac_type, on_site_management. These have no existing per-unit column, so they
-- are nullable everywhere and null UNAMBIGUOUSLY means "inherit". This avoids
-- the false-vs-unset trap that the existing NOT NULL feature booleans
-- (heat/water/hydro_included, pets_*, air_conditioning) carry — extending the
-- profile to THOSE needs a per-field override sentinel + a screening re-test and
-- is deliberately a SEPARATE follow-up slice (it touches the pet_friendly master
-- that S240 screening reads). The bare air_conditioning boolean is KEPT as the
-- back-compat fallback for A/C when no ac_type is resolved (see the app's
-- resolveEffectiveFeatures + buildAmenityChips).
--
-- Forward-compat with the recommended HYBRID granularity: the org columns here
-- are the ORG-LEVEL DEFAULT. A future per-building override slice adds a
-- building-keyed profile row that the app resolves AHEAD of these org columns;
-- resolveEffectiveFeatures(unit, profile) already takes an already-resolved
-- profile object, so that layer slots in without reworking this migration.
--
-- Three additive pieces, no destructive change:
--   1. organizations: the four org-level policy DEFAULT columns.
--   2. properties:     the four per-unit value/override columns (null = inherit).
--   3. Recreate the two READ RPCs (get_public_listing, get_org_listing_feed) —
--      same signatures, CREATE OR REPLACE, byte-for-byte their CURRENT bodies
--      plus the four RESOLVED fields (coalesce(unit, org-default)) so the public
--      page + the syndication feed inherit the profile server-side too (per the
--      standing rule that anon SECURITY DEFINER RPCs replicate the TS merge).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Org-level policy DEFAULTS. lease_term defaults to '1_year' (matches the
--    fill sheet's existing preset, so behavior is unchanged out of the box);
--    the other three are NULL (= no org default yet) until the operator sets
--    them in Settings → Building standard policy.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists policy_lease_term         text not null default '1_year',
  add column if not exists policy_smoking            text,
  add column if not exists policy_ac_type            text,
  add column if not exists policy_on_site_management boolean;

comment on column public.organizations.policy_lease_term is
  'Org-level STANDARD lease term inherited by every unit unless the unit overrides it. Default 1_year matches the fill-sheet preset.';
comment on column public.organizations.policy_smoking is
  'Org-level STANDARD smoking policy (non_smoking | smoking_permitted), null = no default set.';
comment on column public.organizations.policy_ac_type is
  'Org-level STANDARD A/C type (none | window | portable | sleeve | central), null = no default set. Resolves AHEAD of the bare air_conditioning boolean.';
comment on column public.organizations.policy_on_site_management is
  'Org-level STANDARD on-site management flag, null = no default set.';

-- ---------------------------------------------------------------------------
-- 2. Per-unit value / override columns. NULL = inherit the org default; a set
--    value overrides it for this one unit. All nullable from birth, so there is
--    NO false-vs-unset ambiguity for these four fields.
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists lease_term         text,
  add column if not exists smoking            text,
  add column if not exists ac_type            text,
  add column if not exists on_site_management boolean;

comment on column public.properties.lease_term is
  'Per-unit lease term override; null = inherit organizations.policy_lease_term.';
comment on column public.properties.smoking is
  'Per-unit smoking override (non_smoking | smoking_permitted); null = inherit organizations.policy_smoking.';
comment on column public.properties.ac_type is
  'Per-unit A/C type override (none | window | portable | sleeve | central); null = inherit organizations.policy_ac_type. The legacy air_conditioning boolean is the back-compat fallback when neither is set.';
comment on column public.properties.on_site_management is
  'Per-unit on-site management override; null = inherit organizations.policy_on_site_management.';

-- ---------------------------------------------------------------------------
-- 2a. Enum guards (no "add constraint if not exists" in Postgres -> DO blocks).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_policy_lease_term_chk') then
    alter table public.organizations add constraint organizations_policy_lease_term_chk
      check (policy_lease_term in ('month_to_month','6_month','1_year','2_year'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_policy_smoking_chk') then
    alter table public.organizations add constraint organizations_policy_smoking_chk
      check (policy_smoking is null or policy_smoking in ('non_smoking','smoking_permitted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_policy_ac_type_chk') then
    alter table public.organizations add constraint organizations_policy_ac_type_chk
      check (policy_ac_type is null or policy_ac_type in ('none','window','portable','sleeve','central'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_lease_term_chk') then
    alter table public.properties add constraint properties_lease_term_chk
      check (lease_term is null or lease_term in ('month_to_month','6_month','1_year','2_year'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_smoking_chk') then
    alter table public.properties add constraint properties_smoking_chk
      check (smoking is null or smoking in ('non_smoking','smoking_permitted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_ac_type_chk') then
    alter table public.properties add constraint properties_ac_type_chk
      check (ac_type is null or ac_type in ('none','window','portable','sleeve','central'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3a. get_public_listing — CURRENT body + the four RESOLVED policy fields
--     (coalesce(unit override, org default)). CREATE OR REPLACE, no drop.
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
    'lease_term',         coalesce(p.lease_term,         o.policy_lease_term),
    'smoking',            coalesce(p.smoking,            o.policy_smoking),
    'ac_type',            coalesce(p.ac_type,            o.policy_ac_type),
    'on_site_management', coalesce(p.on_site_management, o.policy_on_site_management),
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
-- 3b. get_org_listing_feed — CURRENT body + the four RESOLVED policy fields
--     per listing. CREATE OR REPLACE; o is already in scope for the coalesce.
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
          'lease_term',         coalesce(p.lease_term,         o.policy_lease_term),
          'smoking',            coalesce(p.smoking,            o.policy_smoking),
          'ac_type',            coalesce(p.ac_type,            o.policy_ac_type),
          'on_site_management', coalesce(p.on_site_management, o.policy_on_site_management),
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
