-- ============================================================================
-- 0060_incident_media — private media storage for tenant incident reports
-- (Option B incident-dispatch, Slice 1 — see
--  OPTION-B-INCIDENT-DISPATCH-SLICE-PLAN-2026-06-23.md)
--
-- This is the FIRST private Supabase Storage surface in Vacantless. Unlike
-- `property-photos` (0019), which is a PUBLIC CDN bucket — correct for listing
-- photos a renter is meant to see — incident media is a tenant's photo/video of
-- a problem INSIDE their home and must NEVER be world-readable. So:
--   1. A PRIVATE bucket `incident-media` (public=false). Nothing is served by a
--      guessable public URL; every read goes through a SIGNED URL minted
--      server-side, scoped per actor (operator via RLS; tenant/trade via a
--      token RPC + the service-role client in later slices).
--   2. Storage RLS on storage.objects gating an authenticated user to their OWN
--      org folder for INSERT/UPDATE/DELETE *and* SELECT. The SELECT policy is
--      required even though the bucket is private: an authenticated operator
--      minting a signed URL (or listing/removing) must be able to SEE the row
--      (same lesson as 0025 — no SELECT policy => remove()/createSignedUrl find
--      0 rows). Path convention `<organization_id>/<incident_report_id>/<media_id>.<ext>`
--      — the FIRST segment is the org id, gated via storage.foldername(name)[1].
--      Tenant uploads (no account) use a SIGNED UPLOAD URL minted by the
--      service-role client after a token RPC validates the tenancy — that path
--      does NOT rely on these authenticated policies (the signed URL carries its
--      own authorization). service_role bypasses RLS entirely.
--   3. An `incident_media` metadata table (the bytes live in storage; this row
--      is the pointer), per-org RLS + explicit grants, mirroring the
--      property_photos table shape.
--
-- DEFERRED TO SLICE 2: `incident_report_id` is a plain NOT NULL uuid here — the
-- `incident_reports` table does not exist yet, so its FK is added in the Slice 2
-- migration via an idempotent ALTER (same pattern 0058 used for
-- bank_transactions.expense_id). Every media row still belongs to exactly one
-- report; we just can't reference the table until it exists.
--
-- Conventions mirror the per-org tables in 0019 / 0054: RLS gates rows on
-- organization_id in (select public.user_org_ids()); explicit grants because
-- auto-expose of new tables is OFF; service_role gets DML so the later token
-- RPCs / signed-URL minting (which run as service_role) don't hit the silent
-- permission-denied trap.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Storage bucket — PRIVATE, 25 MB/object ceiling, images + short video only.
--    allowed_mime_types + file_size_limit MUST match lib/incident-media.ts
--    (ALLOWED_INCIDENT_MEDIA_TYPES + the per-kind caps). The 25 MB ceiling is
--    the VIDEO cap (the largest allowed); the lib re-checks the tighter 10 MB
--    image cap per type, and re-validates server-side regardless.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'incident-media',
  'incident-media',
  false,                                          -- PRIVATE: no public CDN URL
  26214400,                                       -- 25 MB (the video cap; the bucket-level ceiling)
  array[
    'image/jpeg', 'image/png', 'image/webp',      -- images
    'video/mp4', 'video/quicktime', 'video/webm'  -- short video (incl. iPhone .mov)
  ]
)
on conflict (id) do update
  set public            = excluded.public,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Storage RLS — authenticated user scoped to their OWN org folder. First
--    path segment = org id. INSERT/UPDATE/DELETE for the operator/service write
--    path; SELECT so an authenticated mint of a signed URL (and list/remove)
--    can locate the row (private bucket => no implicit public read).
-- ---------------------------------------------------------------------------
drop policy if exists "incident_media_insert" on storage.objects;
create policy "incident_media_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'incident-media'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

drop policy if exists "incident_media_update" on storage.objects;
create policy "incident_media_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'incident-media'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  )
  with check (
    bucket_id = 'incident-media'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

drop policy if exists "incident_media_delete" on storage.objects;
create policy "incident_media_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'incident-media'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

drop policy if exists "incident_media_select" on storage.objects;
create policy "incident_media_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'incident-media'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

-- ---------------------------------------------------------------------------
-- 3. incident_media table — attachment metadata (bytes live in the bucket).
--    incident_report_id FK is deferred to Slice 2 (table not created yet).
-- ---------------------------------------------------------------------------
create table if not exists public.incident_media (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  incident_report_id uuid not null,                 -- FK added in Slice 2 (incident_reports)
  storage_path       text not null,                 -- object path inside the private bucket
  mime_type          text not null,
  size_bytes         integer not null check (size_bytes >= 0),
  kind               text not null
                       check (kind in ('image','video')),
  created_at         timestamptz not null default now()
);

create index if not exists incident_media_report_idx
  on public.incident_media(incident_report_id);
create index if not exists incident_media_org_idx
  on public.incident_media(organization_id);

alter table public.incident_media enable row level security;

drop policy if exists incident_media_all on public.incident_media;
create policy incident_media_all on public.incident_media
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- Explicit grants (auto-expose of new tables is OFF). authenticated for the
-- operator dashboard; service_role for the Slice 2/5 token RPCs + signed-URL
-- minting that insert media on behalf of an account-less tenant/trade.
grant select, insert, update, delete on public.incident_media to authenticated;
grant select, insert, update, delete on public.incident_media to service_role;
