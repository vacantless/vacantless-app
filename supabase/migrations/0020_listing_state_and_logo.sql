-- ============================================================================
-- 0020_listing_state_and_logo — Phase A block 2
--
-- PART 1 — per-unit status (Draft / Live / Paused / Leased).
--   properties.status was a text+check column limited to
--   ('available','leased','off_market') (0001_init). Operators need a real
--   "draft" (private, not yet published) and "paused" (temporarily hidden but
--   kept). We EXPAND the check constraint rather than add a parallel column so
--   the single public gate keeps working:
--     * ACTION RPCs (get_public_availability / submit_public_lead /
--       book_public_showing) stay gated on `status = 'available'` (S193/0018) —
--       a whitelist, so the two NEW private states are blocked automatically.
--       Those functions are NOT touched here.
--     * The DISPLAY RPC get_public_listing was on `status <> 'off_market'`.
--       We tighten it to also exclude 'draft', so a draft 404s like off_market,
--       while 'paused' + 'leased' still LOAD so /r can show a "no longer
--       available" state on a link that was already shared.
--   Mapping kept in lockstep with lib/listing-state.ts.
--
-- PART 2 — org-logo upload (first brand-asset Storage surface).
--   organizations.logo_url is already a text URL column consumed by the public
--   page + every branded email. This adds a real UPLOAD path reusing the 0019
--   property-photos pattern: a PUBLIC `org-logos` bucket + write-only RLS on
--   storage.objects scoped to the caller's org folder. Path is
--   `<organization_id>/<file_id>.<ext>` (org id FIRST). No table + no column
--   change: the upload action sets logo_url to the public CDN URL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PART 1.1 — expand the status check constraint.
-- ---------------------------------------------------------------------------
alter table public.properties
  drop constraint if exists properties_status_check;
alter table public.properties
  add constraint properties_status_check
  check (status in ('draft', 'available', 'paused', 'leased', 'off_market'));

-- ---------------------------------------------------------------------------
-- PART 1.2 — get_public_listing: 404 on draft + off_market; load otherwise.
-- Body is byte-for-byte the latest (0019) version except the trailing guard.
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
    and p.status not in ('off_market', 'draft');
$$;

grant execute on function public.get_public_listing(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- PART 2.1 — org-logos Storage bucket. Public read (served via CDN URL),
-- 2 MB/object, web-renderable image types only (incl. SVG for vector logos).
-- allowed_mime_types MUST match ALLOWED_LOGO_TYPES in lib/logo.ts.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-logos',
  'org-logos',
  true,
  2097152,                                          -- 2 MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- PART 2.2 — write policies on storage.objects, scoped to the caller's org
-- folder (first path segment = org id). Read is open (public bucket), so no
-- select policy. Mirrors the 0019 property-photos policies.
-- ---------------------------------------------------------------------------
drop policy if exists "org_logos_insert" on storage.objects;
create policy "org_logos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-logos'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

drop policy if exists "org_logos_update" on storage.objects;
create policy "org_logos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'org-logos'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  )
  with check (
    bucket_id = 'org-logos'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

drop policy if exists "org_logos_delete" on storage.objects;
create policy "org_logos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-logos'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );
