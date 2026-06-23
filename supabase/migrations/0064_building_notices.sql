-- ============================================================================
-- 0064_building_notices — outbound building-wide tenant notices (S321)
--
-- The OUTBOUND counterpart to per-tenancy tenant messaging (0033). A per-tenancy
-- message (tenant_messages) targets ONE tenancy — tenancy_id is NOT NULL — so it
-- cannot model a notice an operator sends to EVERY tenancy in a building at once
-- (the scheduled-building-work case: a whole-building power shutdown for
-- electrical repairs). Rather than loosen the tenant_messages NOT NULL and
-- pollute the per-tenancy history semantics, this is an ISOLATED log pair, the
-- same philosophy used for incident_reports (0061): one write path, one table.
--
-- A building notice is GUARDRAIL-NEUTRAL: operator -> tenant only, EMAIL only for
-- v1, no trade actor, no money, no payment. The operator drafts, reviews, and
-- sends (never auto-send). It is an OPERATOR surface (no anon/token write path),
-- so there is NO new SECURITY DEFINER function — just two per-org tables with the
-- standard RLS + explicit grants, mirroring 0033 exactly.
--
-- The building is identified by building_key (text) — the same normalized street
-- identity used by properties.building_key (0049) and work_orders.building_key
-- (0057). A notice stores the key it targeted plus a human label snapshot, and
-- the action fans out to all tenancies whose unit shares that key. No buildings
-- table, no new grouping, no new RLS surface.
--
-- Two tables:
--   building_notices            — the SEND-LOG parent: one row per send action
--     against a building. Stores the operator-authored subject/body/impact
--     (pre-token-substitution) + denormalized counts so the history list renders
--     without a join. sent_by = the acting member (audit trail).
--   building_notice_deliveries  — per-recipient child: one row per tenant the
--     notice was emailed to, with the tenancy/property context, the destination,
--     and the outcome (sent / failed / skipped) + a machine reason. tenancy_id +
--     tenant_id are SET NULL (not cascade) so the delivery record survives a
--     tenancy/tenant being removed later.
--
-- Conventions mirror 0033/0061: RLS gates on organization_id in
-- (select public.user_org_ids()); explicit grants (auto-expose is OFF);
-- service_role gets DML too (a future send-status callback won't hit the silent
-- permission-denied trap — the 0007 lesson).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- building_notices — send-log parent (one per building broadcast)
-- ---------------------------------------------------------------------------
create table if not exists public.building_notices (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id) on delete cascade,

  -- the building targeted: the normalized key (matches properties.building_key)
  -- plus a human label snapshot (street address) for the history list.
  building_key             text not null,
  building_label           text,

  -- email-only for v1; the column anticipates a future channel without a schema
  -- change (the 0032 CHECK-not-enum lesson).
  channel                  text not null default 'email'
                             check (channel in ('email')),

  -- the operator-authored content (pre-token-substitution), kept for history.
  -- impact = the "what to expect" line an outbound scheduled-work notice needs.
  subject                  text not null,
  body                     text not null,
  impact                   text,

  -- denormalized tallies so the history list renders without a join.
  recipient_tenancy_count  integer not null default 0,
  recipient_count          integer not null default 0,
  sent_count               integer not null default 0,
  failed_count             integer not null default 0,
  skipped_count            integer not null default 0,

  -- the acting member (auth.users id). Audit trail; null-safe if the user is
  -- later removed (set null rather than cascade — keep the notice record).
  sent_by                  uuid references auth.users(id) on delete set null,

  created_at               timestamptz not null default now()
);

create index if not exists building_notices_org_idx
  on public.building_notices(organization_id, created_at desc);
create index if not exists building_notices_building_idx
  on public.building_notices(organization_id, building_key, created_at desc);

-- ---------------------------------------------------------------------------
-- building_notice_deliveries — per-recipient child
-- ---------------------------------------------------------------------------
create table if not exists public.building_notice_deliveries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  notice_id        uuid not null references public.building_notices(id) on delete cascade,

  -- the tenancy + tenant this delivery targeted. set null (not cascade) so the
  -- delivery record survives a tenancy/tenant being removed later.
  tenancy_id       uuid references public.tenancies(id) on delete set null,
  tenant_id        uuid references public.tenants(id)   on delete set null,

  tenant_name      text,
  property_address text,

  channel          text not null default 'email' check (channel in ('email')),
  destination      text,
  status           text not null check (status in ('sent', 'failed', 'skipped')),
  reason           text,

  created_at       timestamptz not null default now()
);

create index if not exists building_notice_deliveries_org_idx
  on public.building_notice_deliveries(organization_id);
create index if not exists building_notice_deliveries_notice_idx
  on public.building_notice_deliveries(notice_id);

-- ---------------------------------------------------------------------------
-- RLS — per-org, same shape as 0033 / 0061.
-- ---------------------------------------------------------------------------
alter table public.building_notices            enable row level security;
alter table public.building_notice_deliveries  enable row level security;

drop policy if exists building_notices_all on public.building_notices;
create policy building_notices_all on public.building_notices
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists building_notice_deliveries_all on public.building_notice_deliveries;
create policy building_notice_deliveries_all on public.building_notice_deliveries
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard; service_role for a future send-status callback / digest cron.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.building_notices           to authenticated;
grant select, insert, update, delete on public.building_notices           to service_role;
grant select, insert, update, delete on public.building_notice_deliveries to authenticated;
grant select, insert, update, delete on public.building_notice_deliveries to service_role;
