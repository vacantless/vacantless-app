-- ============================================================================
-- 0086_org_ingest_addresses — Capture Phase 3, email-in / text-in INGRESS
-- (EMAIL-IN-INGRESS-DESIGN-LOCK-2026-06-28.md), Slice 1 (the security foundation).
--
-- A landlord forwards a phone photo of an appliance plate / store receipt to a
-- per-org address (u-<token>@in.vacantless.com) or texts it in; an inbound
-- provider POSTs app/api/inbound/asset, which resolves the org from the token,
-- checks the From against a per-org verified-sender allow-list (the real trust
-- authority — cf. Expensify's "forward from your registered email address"),
-- validates the attachment, and files a PENDING capture the landlord confirms
-- from the dashboard. Never an unattended write.
--
-- This migration adds ONLY the addressing + allow-list + dedupe schema. It is
-- additive and ships INERT: no addresses or senders exist until Slice 2
-- provisioning, and with no INBOUND_WEBHOOK_SECRET set the route no-ops (dark),
-- so nothing reaches these tables in production yet.
--
-- Three changes:
--   1. org_ingest_addresses — the per-org unguessable token -> org map (the
--      feed/[org] token model), one active address per (org, channel).
--   2. org_ingest_senders   — the per-org verified-sender allow-list. An inbound
--      message creates a usable capture ONLY if its From matches a row here;
--      everything else is quarantined (never bounced). Empty by default.
--   3. documents.source += 'ingest_email','ingest_sms'  + documents.ingest_message_key
--      (a hashed provider message-id, partial-unique) so a provider retry/replay
--      can't create a duplicate capture (Expensify's "duplicate detection").
--
-- Conventions mirror unit_appliances (0082): organization_id denormalized + RLS
-- on user_org_ids(); text + CHECK whitelists (no pg enum); explicit grants
-- (auto-expose OFF) incl. service_role so the webhook's admin client never hits
-- the silent permission-denied trap. No tenant PII lands here — an asset/receipt
-- capture is a manufacturer/transaction record, and only the sender + a hashed
-- message-id are ever stored from an inbound message (never the body/headers).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. org_ingest_addresses — per-org ingest token -> org.
-- ---------------------------------------------------------------------------
create table if not exists public.org_ingest_addresses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,

  -- Which ingress this address serves. 'email' = u-<token>@in.vacantless.com;
  -- 'sms' = a token reserved for a per-org text identity (Channel C). text +
  -- CHECK so a new channel is a one-line change.
  channel          text not null default 'email'
                     check (channel in ('email', 'sms')),

  -- The unguessable, rotatable local-part token (the part after "u-"). Lowercase
  -- base32-ish, validated in lib/email-ingest.isValidIngestToken. Globally unique
  -- so a token resolves to exactly one org with no ambiguity.
  token            text not null unique,

  -- A rotated/disabled address keeps its row (audit) but stops resolving.
  active           boolean not null default true,

  created_at       timestamptz not null default now(),
  rotated_at       timestamptz
);

create index if not exists org_ingest_addresses_org_idx
  on public.org_ingest_addresses(organization_id);

-- At most one ACTIVE address per (org, channel). Partial so a rotated row
-- (active=false) doesn't block issuing a fresh one. This is a uniqueness guard,
-- not an upsert ON CONFLICT target (cf. feedback_upsert_needs_nonpartial_unique_index).
create unique index if not exists org_ingest_addresses_active_uq
  on public.org_ingest_addresses(organization_id, channel)
  where active;

comment on table public.org_ingest_addresses is
  'Per-org ingest address tokens for email-in / text-in asset capture (Phase 3). token = the unguessable local-part after "u-" (u-<token>@in.vacantless.com). One active address per (org, channel); rotatable. Resolved by app/api/inbound/asset to attribute an inbound capture to an org with no login.';

-- ---------------------------------------------------------------------------
-- 2. org_ingest_senders — per-org verified-sender allow-list (the trust authority).
-- ---------------------------------------------------------------------------
create table if not exists public.org_ingest_senders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,

  channel          text not null default 'email'
                     check (channel in ('email', 'sms')),

  -- A NORMALIZED sender: a lowercased bare email (email channel) or an E.164
  -- phone (sms channel). The webhook compares the inbound From, normalized the
  -- same way (lib/email-ingest.normalizeSenderEmail / normalizePhoneE164),
  -- against these. NOT tenant data — the landlord's own forwarding address.
  address          text not null,

  -- When the org verified this sender (a sender is only trusted once verified;
  -- v1 seeds it from the org's own account email/phone in Slice 2 provisioning).
  verified_at      timestamptz,

  created_at       timestamptz not null default now(),

  unique (organization_id, channel, address)
);

create index if not exists org_ingest_senders_org_idx
  on public.org_ingest_senders(organization_id);

comment on table public.org_ingest_senders is
  'Per-org verified-sender allow-list for ingress capture (Phase 3). An inbound email/text creates a usable capture ONLY if its From (normalized) matches a row here; an unknown sender is quarantined, never bounced. Holds the landlord''s own forwarding address(es)/phone(s) — no tenant PII.';

-- ---------------------------------------------------------------------------
-- 3. documents: new ingress sources + a dedupe key.
--    Extend the 0076 source CHECK (inline/auto-named) by dropping the
--    conventional constraint name and recreating it named with the new values.
--    Idempotent: drop-if-exists then add.
-- ---------------------------------------------------------------------------
alter table public.documents
  drop constraint if exists documents_source_check;

alter table public.documents
  add constraint documents_source_check
  check (source in ('uploaded', 'in_app_executed', 'ingest_email', 'ingest_sms'));

-- A hashed provider message-id (lib/email-ingest.ingestDedupeKey) so a provider
-- retry or a deliberate replay of the same inbound message can't file a second
-- capture. NULL for every non-ingress document (the partial-unique index ignores
-- NULLs), so this is invisible to all existing rows/queries.
alter table public.documents
  add column if not exists ingest_message_key text;

create unique index if not exists documents_ingest_message_key_uq
  on public.documents(ingest_message_key)
  where ingest_message_key is not null;

comment on column public.documents.ingest_message_key is
  'SHA-256 of an inbound provider message-id (Phase 3 ingress dedupe). NULL on every non-ingress document. Partial-unique so a provider retry/replay of the same message is idempotent (insert-or-ignore). No raw message-id is ever stored.';

-- ---------------------------------------------------------------------------
-- RLS — per-org (mirror unit_appliances 0082). The dashboard reads these via the
-- RLS server client (Slice 2 provisioning + the review surface); the webhook
-- writes via the service-role admin client (bypasses RLS) AFTER it re-validates
-- the org from the token and the sender from the allow-list itself
-- (feedback_anon_rpc_revalidate_server_side).
-- ---------------------------------------------------------------------------
alter table public.org_ingest_addresses enable row level security;
drop policy if exists org_ingest_addresses_all on public.org_ingest_addresses;
create policy org_ingest_addresses_all on public.org_ingest_addresses
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

alter table public.org_ingest_senders enable row level security;
drop policy if exists org_ingest_senders_all on public.org_ingest_senders;
create policy org_ingest_senders_all on public.org_ingest_senders
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard provisioning/review UI; service_role for the inbound webhook.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.org_ingest_addresses to authenticated;
grant select, insert, update, delete on public.org_ingest_addresses to service_role;
grant select, insert, update, delete on public.org_ingest_senders   to authenticated;
grant select, insert, update, delete on public.org_ingest_senders   to service_role;
