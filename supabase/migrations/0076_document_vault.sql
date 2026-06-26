-- ============================================================================
-- 0076_document_vault — the landlord "document vault" (sign+store+remind hub,
-- the SAVE pillar). Slices 1 + 2 of DOCUMENT-VAULT-DESIGN-2026-06-26.md.
--
-- The vault stores ARBITRARY uploaded signed PDFs (the executed lease signed in
-- SkySlope/DocuSign, scanned/historical leases, amendments, insurance certs),
-- files each to a tenancy (and, in a later slice, a person), and lets the
-- landlord SHARE any document out via an expiring, revocable, tokenized
-- read-only link. This is distinct from `lease_documents` (0039), which holds
-- only IN-APP-assembled lease clause TEXT — there is no file storage there.
--
-- Security posture (the point of the module — it is designed to hold heavy PII):
--   * PRIVATE bucket `documents` (public=false). No public CDN URL; every read
--     is a short-lived SIGNED URL minted server-side. Mirrors `incident-media`
--     (0060), the established private-storage pattern — NOT the public
--     `property-photos` (0019) bucket.
--   * Storage RLS on storage.objects gating an authenticated user to their OWN
--     org folder (first path segment = organization_id) for INSERT/UPDATE/
--     DELETE *and* SELECT. The SELECT policy is required even though the bucket
--     is private (no SELECT => createSignedUrl/remove/list silently find 0 rows
--     — the 0025/0060 lesson).
--   * Per-org RLS on the metadata tables + EXPLICIT grants (auto-expose of new
--     tables is OFF; a missing grant makes JS silently no-op). service_role is
--     granted so the public /d/[token] share viewer (an account-less bearer
--     read) can mint a signed URL after re-validating the token server-side.
--   * The metadata row holds ONLY file metadata (title/type/size/hash/path) —
--     never parsed PII. The bytes live encrypted at rest in the private bucket.
--
-- Conventions mirror 0060 / 0039: RLS gates rows on
-- organization_id in (select public.user_org_ids()); tenancy_id / person_id are
-- ON DELETE SET NULL so an executed document survives the tenancy/person being
-- removed — a permanent legal record.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Storage bucket — PRIVATE, 25 MB/object ceiling, PDFs + scan images only.
--    25 MB fits under the 30 MB server-action body cap (next.config) so an
--    operator upload rides a server action without raising the limit; it MUST
--    match MAX_DOCUMENT_BYTES + ALLOWED_DOCUMENT_TYPES in lib/documents.ts.
--    .docx is deliberately excluded — the vault stores EXECUTED artifacts, not
--    editable drafts.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,                                          -- PRIVATE: no public CDN URL
  26214400,                                       -- 25 MB
  array[
    'application/pdf',                            -- the primary type (signed leases/notices)
    'image/jpeg', 'image/png', 'image/webp'      -- scanned-page fallbacks
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Storage RLS — authenticated user scoped to their OWN org folder. First
--    path segment = org id (storage.foldername(name)[1]). INSERT/UPDATE/DELETE
--    for the operator write/manage path; SELECT so an authenticated mint of a
--    signed URL (and list/remove) can locate the row (private bucket => no
--    implicit read). The public /d/[token] viewer uses service_role, which
--    bypasses RLS, so it does not rely on these policies.
-- ---------------------------------------------------------------------------
drop policy if exists "documents_insert" on storage.objects;
create policy "documents_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

drop policy if exists "documents_update" on storage.objects;
create policy "documents_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  )
  with check (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

drop policy if exists "documents_delete" on storage.objects;
create policy "documents_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

drop policy if exists "documents_select" on storage.objects;
create policy "documents_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1])::uuid in (select public.user_org_ids())
  );

-- ---------------------------------------------------------------------------
-- 3. documents — vault metadata (bytes live in the private bucket).
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  -- the tenancy this document belongs to. SET NULL (not cascade) so the
  -- executed lease — a permanent legal record — survives the tenancy's removal.
  tenancy_id        uuid references public.tenancies(id) on delete set null,
  -- optional cross-tenancy filing to a person (reserved for the Slice 3 person
  -- vault view; not populated in Slice 1/2).
  person_id         uuid references public.persons(id) on delete set null,
  -- optional link to an in-app-assembled lease (0039), so the upload vault and
  -- the in-app rail can present one unified history later.
  lease_document_id uuid references public.lease_documents(id) on delete set null,

  title             text not null,
  doc_type          text not null default 'other'
                      check (doc_type in
                        ('lease','amendment','notice','insurance','id_package','statement','other')),

  storage_path      text not null,                -- <org_id>/<doc_id>.<ext> in the private bucket
  mime_type         text not null,
  size_bytes        integer not null check (size_bytes >= 0),
  sha256            text,                          -- tamper-evidence hash of the bytes (hex)
  source            text not null default 'uploaded'
                      check (source in ('uploaded','in_app_executed')),

  uploaded_by       uuid references auth.users(id) on delete set null,
  deleted_at        timestamptz,                   -- soft-delete (keeps the audit trail)
  retention_until   timestamptz,                   -- optional purge anchor (Slice 3 cron)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists documents_org_idx
  on public.documents(organization_id);
create index if not exists documents_tenancy_idx
  on public.documents(tenancy_id, created_at desc);
create index if not exists documents_person_idx
  on public.documents(person_id, created_at desc);

alter table public.documents enable row level security;

drop policy if exists documents_all on public.documents;
create policy documents_all on public.documents
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.documents to service_role;

-- ---------------------------------------------------------------------------
-- 4. document_share_links — tokenized, expiring, revocable read-only share-out.
--    The token is a 192-bit base64url string (lib/documents.generateShareToken,
--    the lib/lease-signing magic-link pattern). The public /d/[token] viewer
--    re-validates the token server-side via service_role, then mints a signed
--    URL — the token is the only bearer credential a recipient holds.
-- ---------------------------------------------------------------------------
create table if not exists public.document_share_links (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  document_id      uuid not null references public.documents(id) on delete cascade,
  token            text not null unique,
  expires_at       timestamptz not null,
  revoked_at       timestamptz,                    -- one-click revoke
  created_by       uuid references auth.users(id) on delete set null,
  last_accessed_at timestamptz,
  access_count     integer not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists document_share_links_doc_idx
  on public.document_share_links(document_id, created_at desc);
-- token already has a UNIQUE index from the column constraint (the viewer's lookup key).

alter table public.document_share_links enable row level security;

drop policy if exists document_share_links_all on public.document_share_links;
create policy document_share_links_all on public.document_share_links
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.document_share_links to authenticated;
grant select, insert, update, delete on public.document_share_links to service_role;
