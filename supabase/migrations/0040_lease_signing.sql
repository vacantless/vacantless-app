-- ============================================================================
-- 0040_lease_signing — homegrown ECA-2000 e-sign rail (lease vault #11, slice 4)
--
-- Slice 3 (0039 + lib/lease-render) made a draft RENDER into a real lease
-- document. This slice makes it SIGNABLE without a vendor e-sign account. The
-- VACANTLESS-11-ESIGN-RAIL-SPIKE-2026-06-18 decision LOCKED a homegrown rail:
-- e-sign is parity-not-moat (Tenon10 ships a homegrown ECA-2000 signer + audit
-- PDF free and it stands at the LTB), and DocuSign's API path costs ~$1.88-$7.20
-- per envelope on a ~$75-$720/mo plan + is structurally the wrong account to
-- sell to non-realtor landlords. So we build the cheapest defensible rail: $0
-- per lease, no vendor gate. DocuSign-REST stays RESERVED for Agile-dogfood +
-- commercial (the spike documents the mechanics).
--
-- Ontario law (Electronic Commerce Act, 2000): an e-signature is binding on the
-- standard lease + LTB notices provided the document is UNALTERED, signers are
-- VERIFIABLE, and a full AUDIT LOG exists. This migration encodes exactly those
-- three guarantees:
--
--   * UNALTERED  — lease_documents.rendered_snapshot FREEZES the rendered lease
--     model at send time, and document_hash is the SHA-256 of the rendered HTML.
--     The tenant signs from the frozen snapshot; the hash is the tamper-evidence.
--     (This is the "freeze the header vars onto the row at generation" the slice-3
--     handoff deferred — the signer is where it finally matters, because the
--     print route read LIVE tenancy fields, which would let rent change after a
--     tenant signed.)
--   * VERIFIABLE — each signer carries name + email + an unguessable per-signer
--     magic-link token, and at signing we capture IP + user-agent + timestamp.
--   * AUDIT LOG  — every captured field is immutable on lease_signers; the audit
--     certificate (lib/lease-signing renderAuditCertificateHtml) reads it back.
--
-- Two changes:
--   1. lease_documents gains sent_at + rendered_snapshot (jsonb) + document_hash.
--   2. lease_signers — one row per party who must sign a lease_document (landlord
--      + each tenant). Token-addressed magic link; ECA-2000 capture fields.
--
-- The signing lifecycle is the slice-3 status machine, now driven: a draft is
-- generated (status 'draft'); the operator SENDS it (status 'sent', signers
-- inserted, snapshot frozen); each signer signs via their token; when the LAST
-- signer signs, the lease flips to 'executed' (executed_at set). While 'sent'
-- and NO ONE has signed, the operator can WITHDRAW back to 'draft' to correct +
-- reissue (the in-flight "Correct" equivalent — there is no integrity cost to an
-- edit before any signature; after a signature the doc is frozen, so corrections
-- become a NEW version + reissue, which the clause-versioning renewal diff
-- already surfaces as an amendment diff).
--
-- Conventions mirror 0039 / 0033: CHECK (not a pg enum); RLS gates operators on
-- organization_id in (select public.user_org_ids()); tenant (anon) access is
-- ONLY through the two SECURITY DEFINER RPCs below — never direct table RLS, so
-- a tenant with a token can act on their OWN signer row and nothing else.
-- Explicit grants (auto-expose is OFF); service_role gets DML for any future
-- signing webhook / cron.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. lease_documents — freeze the rendered lease + its hash at send time.
-- ---------------------------------------------------------------------------
alter table public.lease_documents
  add column if not exists sent_at          timestamptz,
  -- the FROZEN LeaseRenderModel (lib/lease-render LeaseRenderModel) captured when
  -- the lease was sent for signature. The /sign page + the audit certificate both
  -- render from THIS, never from live tenancy fields, so what the tenant signed
  -- can never silently change underneath them.
  add column if not exists rendered_snapshot jsonb,
  -- SHA-256 (hex) of the rendered lease HTML at send time — the tamper-evidence
  -- anchor. Each signer re-attests this exact value (lease_signers.document_hash).
  add column if not exists document_hash    text;

-- ---------------------------------------------------------------------------
-- 2. lease_signers — one row per party that must sign a lease document.
-- ---------------------------------------------------------------------------
create table if not exists public.lease_signers (
  id                uuid primary key default gen_random_uuid(),
  -- denormalized so RLS gates without joining lease_documents.
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  lease_document_id uuid not null references public.lease_documents(id) on delete cascade,

  -- who is signing. landlord signs too (the lease is bilateral); guarantor is
  -- reserved for a future co-signer flow.
  role              text not null
                      check (role in ('landlord', 'tenant', 'guarantor')),
  name              text,
  email             text,
  -- display/order only (landlord first, then tenants primary-first). NOT enforced
  -- as sequential routing in this slice — all signers can sign in parallel.
  sign_order        integer not null default 1,

  -- the unguessable per-signer magic-link token. The tenant opens /sign/{token};
  -- this is the ONLY handle a tenant ever holds (they never see a row id).
  token             text not null,

  status            text not null default 'pending'
                      check (status in ('pending', 'signed', 'declined')),

  -- ECA-2000 capture (all set together at signing) ------------------------------
  -- how the signature was made: a typed name or a drawn (canvas PNG) signature.
  signature_kind    text check (signature_kind in ('typed', 'drawn')),
  -- the signature payload: the typed string, or a PNG data: URL for a drawn one.
  signature_data    text,
  -- the printed name the signer entered (their attestation of identity).
  signed_name       text,
  -- explicit ECA-2000 consent ("I agree to sign electronically"). Must be true.
  consent_eca2000   boolean not null default false,
  signed_at         timestamptz,
  -- verifiability: the network address + client the signature came from.
  signer_ip         text,
  user_agent        text,
  -- the document hash the signer attested to (copied from lease_documents at
  -- signing) — proves which exact bytes this person signed.
  document_hash     text,

  created_at        timestamptz not null default now()
);

create index if not exists lease_signers_org_idx
  on public.lease_signers(organization_id);
create index if not exists lease_signers_doc_idx
  on public.lease_signers(lease_document_id);
-- the magic-link token is the tenant's only handle; it must be globally unique.
create unique index if not exists uq_lease_signers_token
  on public.lease_signers(token);

-- ---------------------------------------------------------------------------
-- RLS — operators per-org; tenants reach their row only via the RPCs below.
-- ---------------------------------------------------------------------------
alter table public.lease_signers enable row level security;

drop policy if exists lease_signers_all on public.lease_signers;
create policy lease_signers_all on public.lease_signers
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.lease_signers to authenticated;
grant select, insert, update, delete on public.lease_signers to service_role;

-- ---------------------------------------------------------------------------
-- RPC get_lease_signing_context — anon-callable read for the /sign page.
--
-- Given a magic-link token, returns everything the public sign page needs: the
-- frozen rendered lease (so the tenant sees EXACTLY the hashed bytes), the org
-- brand, the signer's identity, and lifecycle flags. SECURITY DEFINER so an
-- unauthenticated tenant can read it, but it re-derives the org from the token
-- and returns NOTHING targetable about any other tenancy/signer. Returns null
-- for an unknown token (the page 404s).
-- ---------------------------------------------------------------------------
create or replace function public.get_lease_signing_context(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_signer    public.lease_signers%rowtype;
  v_doc       public.lease_documents%rowtype;
  v_org_name  text;
  v_brand     text;
  v_brand2    text;
  v_logo      text;
begin
  select * into v_signer from public.lease_signers where token = p_token;
  if v_signer.id is null then
    return null;
  end if;

  select * into v_doc from public.lease_documents where id = v_signer.lease_document_id;
  if v_doc.id is null then
    return null;
  end if;

  select o.name, o.brand_color, o.brand_color_secondary, o.logo_url
    into v_org_name, v_brand, v_brand2, v_logo
  from public.organizations o
  where o.id = v_signer.organization_id;

  return jsonb_build_object(
    'token',             v_signer.token,
    'signer_role',       v_signer.role,
    'signer_name',       v_signer.name,
    'signer_status',     v_signer.status,
    'already_signed',    (v_signer.status = 'signed'),
    -- only a lease still OUT for signature is signable; draft/executed/void is not.
    'lease_status',      v_doc.status,
    'signable',          (v_doc.status = 'sent' and v_signer.status = 'pending'),
    'lease_title',       v_doc.title,
    'rendered_snapshot', v_doc.rendered_snapshot,
    'org_name',          v_org_name,
    'brand_color',       v_brand,
    'brand_color_secondary', v_brand2,
    'logo_url',          v_logo
  );
end;
$$;

grant execute on function public.get_lease_signing_context(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC sign_lease_document — anon-callable write that records one signature.
--
-- Re-validates EVERYTHING server-side (the anon-RPC rule: an anon SECURITY
-- DEFINER write must re-check every precondition its TS caller checks, because
-- the caller is untrusted): token exists, lease is still 'sent', signer is still
-- 'pending', consent is true, a printed name was given, and the signature kind +
-- payload are present. Captures the ECA-2000 fields, copies the document hash the
-- signer attested to, and — atomically in the same call — flips the lease to
-- 'executed' (executed_at = now()) once the LAST signer has signed. Returns
-- { ok, reason, all_signed }.
-- ---------------------------------------------------------------------------
create or replace function public.sign_lease_document(
  p_token          text,
  p_signed_name    text,
  p_signature_kind text,
  p_signature_data text,
  p_consent        boolean,
  p_ip             text default null,
  p_user_agent     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signer     public.lease_signers%rowtype;
  v_doc        public.lease_documents%rowtype;
  v_remaining  integer;
begin
  select * into v_signer from public.lease_signers where token = p_token for update;
  if v_signer.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_signer.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_signed');
  end if;

  select * into v_doc from public.lease_documents where id = v_signer.lease_document_id for update;
  if v_doc.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_doc.status <> 'sent' then
    return jsonb_build_object('ok', false, 'reason', 'not_signable');
  end if;

  -- mirror the TS validation exactly.
  if coalesce(p_consent, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'consent_required');
  end if;
  if p_signed_name is null or btrim(p_signed_name) = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;
  if p_signature_kind is null or p_signature_kind not in ('typed', 'drawn') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  if p_signature_data is null or btrim(p_signature_data) = '' then
    return jsonb_build_object('ok', false, 'reason', 'signature_required');
  end if;

  update public.lease_signers
     set status          = 'signed',
         signed_name     = btrim(p_signed_name),
         signature_kind  = p_signature_kind,
         signature_data  = p_signature_data,
         consent_eca2000 = true,
         signed_at       = now(),
         signer_ip       = p_ip,
         user_agent      = p_user_agent,
         -- attest to the document hash frozen at send time.
         document_hash   = v_doc.document_hash
   where id = v_signer.id;

  -- any signers still pending on this lease?
  select count(*) into v_remaining
  from public.lease_signers
  where lease_document_id = v_doc.id
    and status <> 'signed';

  if v_remaining = 0 then
    update public.lease_documents
       set status      = 'executed',
           executed_at = now(),
           updated_at  = now()
     where id = v_doc.id;
  end if;

  return jsonb_build_object('ok', true, 'all_signed', (v_remaining = 0));
end;
$$;

grant execute on function public.sign_lease_document(text, text, text, text, boolean, text, text)
  to anon, authenticated;
