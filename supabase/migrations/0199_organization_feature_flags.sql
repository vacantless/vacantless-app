-- ============================================================================
-- 0199_organization_feature_flags — per-org feature entitlement overrides
--
-- Absence of a row means "use the plan default in lib/billing.ts." A row is a
-- deliberate per-org override, allowing a feature to be enabled or disabled for
-- one organization without changing its billing plan. Env master switches still
-- win for features that have one.
--
-- RLS + grants mirror the org-scoped notification_settings pattern: org members
-- can manage their own org's rows through Settings, and service_role can read
-- or write rows for cron/public-token paths that run outside a user session.
-- ============================================================================

create table if not exists public.organization_feature_flags (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key     text not null,
  enabled         boolean not null default false,
  updated_at      timestamptz not null default now(),

  primary key (organization_id, feature_key)
);

create index if not exists organization_feature_flags_org_idx
  on public.organization_feature_flags(organization_id);

alter table public.organization_feature_flags enable row level security;

drop policy if exists organization_feature_flags_all on public.organization_feature_flags;
create policy organization_feature_flags_all on public.organization_feature_flags
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

comment on table public.organization_feature_flags is
  'Per-organization feature overrides. Absence falls back to lib/billing.ts plan defaults; env master switches still win where configured.';

comment on column public.organization_feature_flags.feature_key is
  'Code-defined feature key resolved by lib/feature-entitlements.ts.';

grant select, insert, update, delete on public.organization_feature_flags to authenticated;
grant select, insert, update, delete on public.organization_feature_flags to service_role;
