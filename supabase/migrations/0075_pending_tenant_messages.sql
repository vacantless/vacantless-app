-- ============================================================================
-- 0075_pending_tenant_messages — the APPROVAL-GATED tenant message queue (S341;
-- the second send-mode tier, "approve_to_send"; see
-- APPROVAL-GATED-SEND-MODE-SPEC-2026-06-26.md).
--
-- The keystone of the compliance-comms reframe ("a landlord-to-tenant comms
-- drip, compliance-triggered"). A drip step never emails a tenant from a
-- trigger — it DRAFTS a row here, and a human operator reviews/edits and taps
-- Approve & Send. This release's only writer is app/api/cron/rent-increase,
-- which (when the org has opted the drip on) drafts the soft, non-legal
-- "leasing.rent_increase_tenant_notice" courtesy note alongside the landlord N1
-- nudge. The N1 itself stays a separate operator-served document.
--
-- Identity model: rows are pure operator-side data. The CRON (service_role)
-- INSERTS drafts; the OPERATOR (authenticated member) reads the queue + approves/
-- dismisses/edits under per-org RLS. No anon surface, no token RPC. Conventions
-- mirror 0067/0070: status as a CHECK (not a pg enum) for one-line extensibility;
-- per-org RLS on organization_id in (select public.user_org_ids()); EXPLICIT
-- grants because auto-expose is OFF; service_role DML so the cron never hits the
-- silent permission-denied trap (feedback_supabase_new_table_needs_table_grant).
-- The status machine + length bounds are MIRRORED in lib/tenant-message-approvals
-- (validateTenantMessageEdit / canApprove / canDismiss).
-- ============================================================================

create table if not exists public.pending_tenant_messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- which registered notification event drafted this (a sendMode=approve_to_send
  -- event in lib/notifications NOTIFICATION_EVENTS, e.g.
  -- 'leasing.rent_increase_tenant_notice'). Text, not an fk — the registry is
  -- code, not a table (mirrors notification_settings.event_key).
  event_key       text not null,

  -- the source records (snapshots kept on the row so the queue renders even if a
  -- record later changes). tenancy cascades (a deleted tenancy drops its drafts);
  -- property set-null (a draft survives a property edit, addressed by snapshot).
  tenancy_id      uuid references public.tenancies(id) on delete cascade,
  property_id     uuid references public.properties(id) on delete set null,
  tenant_name     text,
  tenant_email    text,

  -- the drafted message, rendered at enqueue from the event template + tokens and
  -- OPERATOR-EDITABLE before send. Non-blank, bounded (mirrors
  -- MAX_TENANT_MESSAGE_SUBJECT_LEN / MAX_TENANT_MESSAGE_BODY_LEN). The send uses
  -- THIS stored copy (not a re-render) so an operator edit is real.
  subject         text not null
                    check (length(btrim(subject)) between 1 and 200),
  body            text not null
                    check (length(btrim(body)) between 1 and 8000),

  -- idempotency: one draft per (tenancy, event, cycle). For the rent-increase
  -- note = '{event}:{tenancy}:{earliestEffectiveDate}' (tenantNoticeDedupeKey),
  -- the same stable anchor leasing.rent_increase stamps — so the 15-min pinger
  -- drafts at most once per cycle. Nullable for a future operator-initiated draft.
  dedupe_key      text,

  -- one-way status machine: pending -> sent | dismissed. Mirrors
  -- PendingMessageStatus + canApprove/canDismiss.
  status          text not null default 'pending'
                    check (status in ('pending','sent','dismissed')),

  created_at      timestamptz not null default now(),
  approved_at     timestamptz,
  sent_at         timestamptz,
  dismissed_at    timestamptz,
  -- the member who approved/dismissed (audit; null for an untouched draft).
  decided_by      uuid references auth.users(id) on delete set null
);

-- the hot read: a queue of pending drafts for an org, newest-first.
create index if not exists pending_tenant_messages_org_status_idx
  on public.pending_tenant_messages(organization_id, status, created_at desc);

-- idempotency guard for the cron: at most one row per (org, event, dedupe_key).
-- NOT partial — Postgres treats NULLs as DISTINCT by default, so a null
-- dedupe_key (a future operator-initiated draft) is never blocked, while two
-- cron drafts for the same cycle DO collide. A non-partial index is also a clean
-- ON CONFLICT target for the upsert in app/api/cron/rent-increase (a partial
-- index can't be inferred from the column-list conflict target).
create unique index if not exists pending_tenant_messages_dedupe_idx
  on public.pending_tenant_messages(organization_id, event_key, dedupe_key);

alter table public.pending_tenant_messages enable row level security;

-- Operators: standard per-org policy (read the queue, approve/dismiss/edit).
-- The cron inserts as service_role (bypasses RLS); the explicit grant below is
-- still required so the authenticated DML doesn't silently no-op.
drop policy if exists pending_tenant_messages_all on public.pending_tenant_messages;
create policy pending_tenant_messages_all on public.pending_tenant_messages
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.pending_tenant_messages to authenticated;
grant select, insert, update, delete on public.pending_tenant_messages to service_role;
