-- ============================================================================
-- 0019_property_photos — photo upload + public gallery MVP
--
-- Adds the first Supabase Storage surface to Vacantless:
--   1. A PUBLIC bucket `property-photos` (images served via the public CDN URL
--      so the dashboard + the public /r page can <img src=…> with no signing).
--   2. Write-side RLS on storage.objects so an authenticated user can only
--      upload/update/delete under their OWN org's folder. Path convention is
--      `<organization_id>/<property_id>/<photo_id>.<ext>` — the FIRST segment is
--      the org id, which the policies gate on via storage.foldername(name)[1].
--      Read is open because the bucket is public (no select policy needed).
--   3. A `property_photos` table (one property -> many photos) with the usual
--      per-org RLS + grant, a partial unique index enforcing at most one cover
--      per property, and ordering columns.
--   4. get_public_listing extended to return an ordered `photos` array (cover
--      first, then sort_order) so the public page renders the gallery. The RPC
--      is SECURITY DEFINER, so anon needs no direct grant on property_photos.
--
-- Mirrors the per-org table pattern from 0014 (listing_posts) and the
-- create-or-replace RPC discipline from 0013/0018.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Storage bucket — public read, 10 MB/object, web-renderable images only.
--    allowed_mime_types MUST match ALLOWED_PHOTO_TYPES in lib/photos.ts.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-photos',
  'property-photos',
  true,
  10485760,                                       -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public            = excluded.public,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Storage write policies — scoped to the caller's org folder. storage.objects
--    already has RLS enabled by Supabase; we only add policies. The first path
--    segment is the org id; cast + membership-check against user_org_ids().
-- ---------------------------------------------------------------------------
drop policy if exists "property_photos_insert" on storage.objects;
create policy "property_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'property-photos'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

drop policy if exists "property_photos_update" on storage.objects;
create policy "property_photos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'property-photos'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  )
  with check (
    bucket_id = 'property-photos'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

drop policy if exists "property_photos_delete" on storage.objects;
create policy "property_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'property-photos'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

-- ---------------------------------------------------------------------------
-- 3. property_photos table
-- ---------------------------------------------------------------------------
create table if not exists public.property_photos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id     uuid not null references public.properties(id) on delete cascade,
  storage_path    text not null,                  -- object path inside the bucket
  url             text not null,                  -- public URL we render
  sort_order      integer not null default 0,     -- ascending = display order
  is_cover        boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists idx_property_photos_property
  on public.property_photos(property_id);
create index if not exists idx_property_photos_org
  on public.property_photos(organization_id);
-- At most one cover photo per property (partial unique index).
create unique index if not exists uq_property_photos_one_cover
  on public.property_photos(property_id)
  where is_cover;

alter table public.property_photos enable row level security;

drop policy if exists property_photos_all on public.property_photos;
create policy property_photos_all on public.property_photos
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.property_photos to authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_public_listing — add the ordered photos[] array. Cover first, then
--    sort_order, then created_at. Everything else is byte-for-byte the 0013
--    body (kept on `status <> 'off_market'` so a leased unit still renders the
--    "no longer available" page rather than 404'ing — see 0018).
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
    'logo_url',         o.logo_url,
    'photos',           coalesce((
      select jsonb_agg(ph.url order by ph.is_cover desc, ph.sort_order asc, ph.created_at asc)
      from public.property_photos ph
      where ph.property_id = p.id
    ), '[]'::jsonb)
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id
    and p.status <> 'off_market';
$$;

grant execute on function public.get_public_listing(uuid) to anon, authenticated;
