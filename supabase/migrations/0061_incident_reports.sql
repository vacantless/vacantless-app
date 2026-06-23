-- ============================================================================
-- 0061_incident_reports — tenant tokenized incident intake
-- (Option B incident-dispatch, Slice 2 — see
--  OPTION-B-INCIDENT-DISPATCH-SLICE-PLAN-2026-06-23.md §3, §4, §6).
--
-- Slice 1 (0060) built the PRIVATE incident-media storage surface. This slice
-- builds the FIRST-EVER tenant write path beyond a lead inquiry / a lease
-- signature: a tenant, with NO account, reaches a per-tenancy magic-link
-- (/report/[token]), describes a problem, optionally attaches photos/short
-- video, and submits. That report lands in a dedicated `incident_reports` table
-- — deliberately OFF the operator's work_orders queue until approved — so
-- unapproved tenant noise never pollutes the work list. Approval (Slice 3)
-- promotes a report into a real work_orders row.
--
-- Identity model (plan §2, §4 — LOCKED token-first): the tenant is account-less.
-- The ONLY thing they hold is the tenancy's stable `report_token`. Every read
-- and write is a SECURITY DEFINER RPC that RE-DERIVES organization_id /
-- tenancy_id / property_id FROM THE TOKEN and trusts nothing else the client
-- sends (feedback_anon_rpc_revalidate_server_side). This mirrors the proven
-- /sign lease-signing rail (0040): a non-account third party, a scoped
-- single-purpose surface, every precondition re-checked in SQL.
--   Difference from /sign: a lease-signer token is single-document/single-use;
--   a tenancy report token is STABLE and reusable — one bookmarked link lets a
--   tenant report many incidents over the life of the tenancy.
--
-- Four changes:
--   1. tenancies gains `report_token` (the tenant's per-tenancy handle) — added
--      via idempotent ALTER, partial-unique.
--   2. `incident_reports` table — the tenant intake, per-org RLS for operators;
--      tenants reach it ONLY through the RPCs.
--   3. incident_media gains its FK to incident_reports (DEFERRED from 0060 —
--      idempotent ALTER, same pattern 0058 used for bank_transactions.expense_id).
--   4. Four SECURITY DEFINER token RPCs: read context, submit a report, authorize
--      a media upload (so the server action can mint a signed upload URL against
--      a server-trusted org/report), and record the uploaded media row.
--
-- Conventions mirror 0040 / 0054 / 0060: CHECK (not a pg enum) so adding a
-- state/category later is a one-line change; RLS gates operators on
-- organization_id in (select public.user_org_ids()); explicit grants because
-- auto-expose is OFF; service_role gets DML so the signed-URL/RPC paths that run
-- as service_role don't hit the silent permission-denied trap.
--
-- The category whitelist + the description rules + the status set are MIRRORED
-- verbatim in lib/incident-reports.ts; the submit RPC re-checks them so both
-- sides agree (the anon-RPC re-validate rule). The media MIME/size limits are
-- mirrored from lib/incident-media.ts + the 0060 bucket config.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. tenancies.report_token — the tenant's per-tenancy magic-link handle.
--    Nullable: minted lazily by the operator "copy tenant report link" action
--    (an existing tenancy gets a token the first time the link is requested).
--    Partial-unique so many tenancies can have NULL but a set token is globally
--    unique (the token is the only lookup key in the RPCs).
-- ---------------------------------------------------------------------------
alter table public.tenancies
  add column if not exists report_token text;

create unique index if not exists uq_tenancies_report_token
  on public.tenancies(report_token)
  where report_token is not null;

-- ---------------------------------------------------------------------------
-- 2. incident_reports — the tenant intake, kept OFF work_orders until approved.
-- ---------------------------------------------------------------------------
create table if not exists public.incident_reports (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  -- the tenancy the report came from. cascade: if the tenancy is deleted the
  -- pre-approval report goes with it (an APPROVED report has already become a
  -- work_orders row, whose cost history is preserved independently via 0054's
  -- set-null on tenancy_id).
  tenancy_id              uuid not null references public.tenancies(id) on delete cascade,
  -- snapshot of the unit at report time (set-null: the report text outlives a
  -- removed unit; the operator still wants the history).
  property_id             uuid references public.properties(id) on delete set null,

  -- reporter snapshot — the tenant has no account, so we freeze who reported it.
  reporter_name           text,
  reporter_contact        text,

  -- IDENTICAL to work_orders.category (0054) so an approved report maps 1:1.
  category                text not null default 'general'
                            check (category in ('plumbing','electrical','hvac','appliance',
                                                'structural','pest','landscaping','cleaning','general')),
  description             text not null,

  status                  text not null default 'submitted'
                            check (status in ('submitted','under_review','approved','converted','declined')),
  decline_reason          text,

  -- set when approved+promoted to the work_orders spine (Slice 3).
  converted_work_order_id uuid references public.work_orders(id) on delete set null,

  submitted_at            timestamptz not null default now(),
  reviewed_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists incident_reports_org_idx
  on public.incident_reports(organization_id);
create index if not exists incident_reports_tenancy_idx
  on public.incident_reports(tenancy_id);
create index if not exists incident_reports_status_idx
  on public.incident_reports(organization_id, status);

alter table public.incident_reports enable row level security;

-- Operators: standard per-org policy. Tenants NEVER touch this table directly —
-- only through the SECURITY DEFINER RPCs below.
drop policy if exists incident_reports_all on public.incident_reports;
create policy incident_reports_all on public.incident_reports
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.incident_reports to authenticated;
grant select, insert, update, delete on public.incident_reports to service_role;

-- ---------------------------------------------------------------------------
-- 3. incident_media FK (deferred from 0060) — now that incident_reports exists,
--    attach the FK. Idempotent: drop-if-exists then add, so a re-run is safe
--    (same pattern 0058 used for bank_transactions.expense_id).
-- ---------------------------------------------------------------------------
alter table public.incident_media
  drop constraint if exists incident_media_report_fk;
alter table public.incident_media
  add constraint incident_media_report_fk
  foreign key (incident_report_id)
  references public.incident_reports(id)
  on delete cascade;

-- ---------------------------------------------------------------------------
-- RPC get_incident_report_context — anon-callable read for the /report page.
--
-- Given a tenancy report token, returns everything the public report page needs:
-- org brand, the unit address, whether the tenancy is currently accepting
-- reports, and the prefilled reporter identity (primary tenant). SECURITY
-- DEFINER so an account-less tenant can read it; it re-derives the org from the
-- token and returns NOTHING about any other tenancy. Returns null for an unknown
-- token (the page 404s).
-- ---------------------------------------------------------------------------
create or replace function public.get_incident_report_context(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenancy   public.tenancies%rowtype;
  v_org_name  text;
  v_brand     text;
  v_brand2    text;
  v_logo      text;
  v_address   text;
  v_rep_name  text;
  v_rep_contact text;
begin
  if p_token is null or btrim(p_token) = '' then
    return null;
  end if;

  select * into v_tenancy from public.tenancies where report_token = p_token;
  if v_tenancy.id is null then
    return null;
  end if;

  select o.name, o.brand_color, o.brand_color_secondary, o.logo_url
    into v_org_name, v_brand, v_brand2, v_logo
  from public.organizations o
  where o.id = v_tenancy.organization_id;

  select p.address into v_address
  from public.properties p
  where p.id = v_tenancy.property_id;

  -- primary tenant first; contact prefers email, then phone. Mirrors
  -- lib/incident-reports.deriveReporterDefaults.
  select t.name,
         coalesce(nullif(btrim(t.email), ''), nullif(btrim(t.phone), ''))
    into v_rep_name, v_rep_contact
  from public.tenants t
  where t.tenancy_id = v_tenancy.id
  order by t.is_primary desc, t.created_at asc
  limit 1;

  return jsonb_build_object(
    'token',            v_tenancy.report_token,
    -- a report can be filed while the tenancy is upcoming or active, not after it ends.
    'accepting',        (v_tenancy.status in ('active','upcoming')),
    'tenancy_status',   v_tenancy.status,
    'property_address', v_address,
    'reporter_name',    v_rep_name,
    'reporter_contact', v_rep_contact,
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'brand_color_secondary', v_brand2,
    'logo_url',         v_logo
  );
end;
$$;

grant execute on function public.get_incident_report_context(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC submit_incident_report — anon-callable write that creates a report.
--
-- Re-derives org/tenancy/property FROM THE TOKEN (never trusts a client id), and
-- re-validates EVERY rule lib/incident-reports.validateReportSubmission checks
-- (the anon-RPC rule): the tenancy is still accepting, the category is in the
-- whitelist, the description is present and within length. Returns
-- { ok, report_id, organization_id, reason }.
-- ---------------------------------------------------------------------------
create or replace function public.submit_incident_report(
  p_token            text,
  p_category         text,
  p_description      text,
  p_reporter_name    text default null,
  p_reporter_contact text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenancy public.tenancies%rowtype;
  v_desc    text;
  v_report  public.incident_reports%rowtype;
begin
  select * into v_tenancy from public.tenancies where report_token = p_token for update;
  if v_tenancy.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_tenancy.status not in ('active','upcoming') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  -- mirror lib/incident-reports.validateReportSubmission exactly.
  if p_category is null or p_category not in
       ('plumbing','electrical','hvac','appliance','structural','pest','landscaping','cleaning','general') then
    return jsonb_build_object('ok', false, 'reason', 'bad_category');
  end if;

  v_desc := btrim(coalesce(p_description, ''));
  if length(v_desc) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'description_required');
  end if;
  if length(v_desc) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'description_too_long');
  end if;

  insert into public.incident_reports (
    organization_id, tenancy_id, property_id,
    reporter_name, reporter_contact,
    category, description, status
  ) values (
    v_tenancy.organization_id, v_tenancy.id, v_tenancy.property_id,
    nullif(btrim(coalesce(p_reporter_name, '')), ''),
    nullif(btrim(coalesce(p_reporter_contact, '')), ''),
    p_category, v_desc, 'submitted'
  )
  returning * into v_report;

  return jsonb_build_object(
    'ok', true,
    'report_id', v_report.id,
    'organization_id', v_report.organization_id
  );
end;
$$;

grant execute on function public.submit_incident_report(text, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC authorize_incident_media_upload — anon-callable authorization check.
--
-- Confirms (token, report) belong together and the report is still OPEN
-- (submitted | under_review) so it can accept media, and returns the
-- SERVER-TRUSTED organization_id. The server action uses that org id + the
-- report id to build the storage path (lib/incident-media.incidentMediaStoragePath)
-- and mint a signed UPLOAD url via the service-role client — so a guessed/forged
-- org id can never steer an upload into another org's folder. Returns
-- { ok, organization_id, reason }.
-- ---------------------------------------------------------------------------
create or replace function public.authorize_incident_media_upload(
  p_token     text,
  p_report_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenancy public.tenancies%rowtype;
  v_report  public.incident_reports%rowtype;
begin
  select * into v_tenancy from public.tenancies where report_token = p_token;
  if v_tenancy.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_report from public.incident_reports
   where id = p_report_id and tenancy_id = v_tenancy.id;
  if v_report.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_report.status not in ('submitted','under_review') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  return jsonb_build_object('ok', true, 'organization_id', v_report.organization_id);
end;
$$;

grant execute on function public.authorize_incident_media_upload(text, uuid)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC record_incident_media — anon-callable write that records one media row
-- AFTER its bytes have been PUT to the signed upload url.
--
-- Re-validates (the anon-RPC rule) everything: (token, report) belong together,
-- the report is still open, the storage_path lives under THIS org+report folder
-- (so the metadata row can't point at someone else's object), the MIME type is
-- in the allowed set, the kind matches the MIME, and the size is within the
-- per-kind cap (mirrors lib/incident-media + the 0060 bucket config). Inserts
-- the incident_media row. Returns { ok, media_id, reason }.
-- ---------------------------------------------------------------------------
create or replace function public.record_incident_media(
  p_token        text,
  p_report_id    uuid,
  p_storage_path text,
  p_mime_type    text,
  p_size_bytes   integer,
  p_kind         text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenancy public.tenancies%rowtype;
  v_report  public.incident_reports%rowtype;
  v_prefix  text;
  v_max     integer;
  v_media   public.incident_media%rowtype;
begin
  select * into v_tenancy from public.tenancies where report_token = p_token;
  if v_tenancy.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_report from public.incident_reports
   where id = p_report_id and tenancy_id = v_tenancy.id
   for update;
  if v_report.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_report.status not in ('submitted','under_review') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  -- the path MUST be under <org>/<report>/ — defense in depth against a forged
  -- path pointing the metadata row at another org/report's object.
  v_prefix := v_report.organization_id::text || '/' || v_report.id::text || '/';
  if p_storage_path is null or position(v_prefix in p_storage_path) <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'bad_path');
  end if;

  -- MIME + kind whitelist (mirror lib/incident-media + 0060 bucket).
  if p_kind not in ('image','video') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  if p_kind = 'image' and p_mime_type not in ('image/jpeg','image/png','image/webp') then
    return jsonb_build_object('ok', false, 'reason', 'bad_type');
  end if;
  if p_kind = 'video' and p_mime_type not in ('video/mp4','video/quicktime','video/webm') then
    return jsonb_build_object('ok', false, 'reason', 'bad_type');
  end if;

  -- per-kind size cap: image 10 MB, video 25 MB.
  v_max := case when p_kind = 'video' then 26214400 else 10485760 end;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > v_max then
    return jsonb_build_object('ok', false, 'reason', 'bad_size');
  end if;

  insert into public.incident_media (
    organization_id, incident_report_id, storage_path, mime_type, size_bytes, kind
  ) values (
    v_report.organization_id, v_report.id, p_storage_path, p_mime_type, p_size_bytes, p_kind
  )
  returning * into v_media;

  return jsonb_build_object('ok', true, 'media_id', v_media.id);
end;
$$;

grant execute on function public.record_incident_media(text, uuid, text, text, integer, text)
  to anon, authenticated;
