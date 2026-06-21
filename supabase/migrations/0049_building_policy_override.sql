-- ============================================================================
-- 0049_building_policy_override — STANDARD-POLICY profile slice 2 (the HYBRID
-- per-building layer). Slice 1 (0048) shipped the ORG-level defaults; this adds
-- an optional PER-BUILDING override that resolves AHEAD of the org default, so
-- the resolution becomes:  unit override  >  building override  >  org default.
--
-- Why (the evidence): Agile spans 3 live buildings (2419 Mercer, 506 Manning,
-- 833 Pillette) with DIFFERENT policies. An org-only profile (0048) is wrong for
-- some buildings — set A/C=sleeve org-wide and Mercer/Manning get mislabelled.
-- The only fix at slice-1 was per-UNIT keying (re-typing the building-constant
-- value on every unit), exactly the re-keying the profile exists to remove. A
-- per-building layer lets the operator set A/C / smoking / lease term / on-site
-- management ONCE per building and have every unit in that building inherit it.
--
-- Scope = the SAME FOUR genuinely-new policy fields 0048 owns (lease_term /
-- smoking / ac_type / on_site_management). Extending inheritance to the legacy
-- NOT NULL feature booleans (utilities / pets) needs a per-field override
-- sentinel + a screening re-test (it touches the pet_friendly master S240 reads)
-- and stays a SEPARATE follow-up slice — untouched here.
--
-- "Building" identity = a normalized building_key derived from the street
-- portion of properties.address (there is still no buildings table; a building
-- is just the units that share a street address). The key is a STORED GENERATED
-- column off an IMMUTABLE function, so it stays correct on insert/update and is
-- populated for all existing rows at ALTER time — no app-side normalization, no
-- TS/SQL drift, and the public RPCs can join on it server-side.
--
-- Forward-compat already in place: lib/policy-profile.resolveEffectiveFeatures
-- takes an ALREADY-RESOLVED PolicyProfile, so the app resolves building-over-org
-- BEFORE calling it (lib/policy-profile.resolveBuildingProfile) — no change to
-- the existing merge. The RPCs replicate the same coalesce in SQL per the
-- standing rule that anon SECURITY DEFINER RPCs mirror the TS merge.
--
-- Four additive pieces, no destructive change:
--   1. building_key(text) IMMUTABLE helper (mirrors lib splitAddressUnit).
--   2. properties.building_key STORED GENERATED column + index.
--   3. org_building_policies table (org_id, building_key, the 4 policy cols),
--      all four NULLABLE (null = inherit org), unique per (org, building_key).
--   4. Recreate get_public_listing + get_org_listing_feed to coalesce
--      unit > building > org for the four policy fields.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. building_key — the normalized street identity. Lowercase, strip a trailing
--    unit/suite/apt/# segment (mirrors lib/listing-fill-sheet.splitAddressUnit),
--    collapse whitespace, strip stray leading/trailing commas. IMMUTABLE so it
--    can back a STORED generated column. Input is lowercased first, so the unit
--    designators are matched case-insensitively without the 'i' flag. Returns
--    null for a blank/unit-only address (no building to key on).
-- ---------------------------------------------------------------------------
create or replace function public.building_key(p_address text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(coalesce(p_address, '')),
            -- a unit designator (word-bounded) or '#', then its token, removed
            '[,[:space:]]*(\y(unit|suite|ste|apt|apartment)\y\.?|#)[[:space:]]*[a-z0-9-]+',
            '',
            'g'
          ),
          '[[:space:]]+', ' ', 'g'                 -- collapse internal whitespace
        ),
        '(^[[:space:],]+)|([[:space:],]+$)', '', 'g'  -- trim edge spaces/commas
      ),
      ' '
    ),
    ''
  );
$$;

comment on function public.building_key(text) is
  'Normalized building identity from a unit address: lowercased street portion with the unit/suite/apt/# segment stripped. Units in the same building share this key. Mirrors lib/listing-fill-sheet.splitAddressUnit. IMMUTABLE so it backs properties.building_key (a stored generated column).';

-- ---------------------------------------------------------------------------
-- 2. properties.building_key — STORED generated column + index for the join /
--    the per-building grouping in the editor. Populated for every existing row
--    at ALTER time; recomputed automatically whenever address changes.
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists building_key text
    generated always as (public.building_key(address)) stored;

comment on column public.properties.building_key is
  'Generated: normalized building identity (public.building_key(address)). Units sharing a street address share this key; used to resolve the per-building policy override (org_building_policies) ahead of the org default.';

create index if not exists properties_org_building_key_idx
  on public.properties(organization_id, building_key);

-- ---------------------------------------------------------------------------
-- 3. org_building_policies — one optional override row per (org, building). All
--    four policy columns NULLABLE: null = inherit the org default (0048),
--    a set value overrides it for every unit in that building. Same CHECK
--    vocab as the org columns. RLS + grants mirror 0042 persons.
-- ---------------------------------------------------------------------------
create table if not exists public.org_building_policies (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  building_key              text not null,
  policy_lease_term         text,
  policy_smoking            text,
  policy_ac_type            text,
  policy_on_site_management boolean,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (organization_id, building_key)
);

comment on table public.org_building_policies is
  'Per-building STANDARD-POLICY override (slice 2). Resolves AHEAD of organizations.policy_* and BEHIND a unit''s own value: unit > building > org. All four policy columns nullable; null = inherit the org default.';

create index if not exists org_building_policies_org_idx
  on public.org_building_policies(organization_id);

-- enum guards (no "add constraint if not exists" -> DO block, mirrors 0048).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_building_policies_lease_term_chk') then
    alter table public.org_building_policies add constraint org_building_policies_lease_term_chk
      check (policy_lease_term is null or policy_lease_term in ('month_to_month','6_month','1_year','2_year'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_building_policies_smoking_chk') then
    alter table public.org_building_policies add constraint org_building_policies_smoking_chk
      check (policy_smoking is null or policy_smoking in ('non_smoking','smoking_permitted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_building_policies_ac_type_chk') then
    alter table public.org_building_policies add constraint org_building_policies_ac_type_chk
      check (policy_ac_type is null or policy_ac_type in ('none','window','portable','sleeve','central'));
  end if;
end $$;

alter table public.org_building_policies enable row level security;

drop policy if exists org_building_policies_all on public.org_building_policies;
create policy org_building_policies_all on public.org_building_policies
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.org_building_policies to authenticated;
grant select, insert, update, delete on public.org_building_policies to service_role;

-- ---------------------------------------------------------------------------
-- 4a. get_public_listing — resolve unit > building > org for the four policy
--     fields. LEFT JOIN the building override on (org, building_key); a unit
--     with no building override or no key simply falls through to the org
--     default (identical to 0048 behavior). CREATE OR REPLACE, no drop.
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
    'lease_term',         coalesce(p.lease_term,         bp.policy_lease_term,         o.policy_lease_term),
    'smoking',            coalesce(p.smoking,            bp.policy_smoking,            o.policy_smoking),
    'ac_type',            coalesce(p.ac_type,            bp.policy_ac_type,            o.policy_ac_type),
    'on_site_management', coalesce(p.on_site_management, bp.policy_on_site_management, o.policy_on_site_management),
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
  left join public.org_building_policies bp
    on bp.organization_id = p.organization_id
   and bp.building_key = p.building_key
  where p.id = p_property_id
    and p.status not in ('off_market', 'draft');
$$;

grant execute on function public.get_public_listing(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4b. get_org_listing_feed — same unit > building > org resolution per listing.
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
          'lease_term',         coalesce(p.lease_term,         bp.policy_lease_term,         o.policy_lease_term),
          'smoking',            coalesce(p.smoking,            bp.policy_smoking,            o.policy_smoking),
          'ac_type',            coalesce(p.ac_type,            bp.policy_ac_type,            o.policy_ac_type),
          'on_site_management', coalesce(p.on_site_management, bp.policy_on_site_management, o.policy_on_site_management),
          'photos',           coalesce((
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
