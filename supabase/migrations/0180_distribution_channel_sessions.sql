-- ============================================================================
-- 0180_distribution_channel_sessions
--
-- BACK-PORT (repo/prod parity, no prod write): this migration was applied to
-- prod on 2026-07-22 (schema_migrations version 20260722163346, name
-- "0180_distribution_channel_sessions") but the file was never committed to the
-- repo, leaving a 0179 -> 0181 gap. Body is the exact prod-applied SQL.
-- Idempotent: safe to re-run. See reference_migration_ledger_drift.
-- ============================================================================

create table if not exists public.distribution_channel_sessions (
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  channel           text not null,
  encrypted_state   bytea not null,
  iv                bytea not null,
  auth_tag          bytea not null,
  expires_at        timestamptz,
  last_validated_at timestamptz,
  warmed_by         uuid,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  primary key (organization_id, channel)
);

alter table public.distribution_channel_sessions enable row level security;

drop policy if exists distribution_channel_sessions_service on public.distribution_channel_sessions;
create policy distribution_channel_sessions_service on public.distribution_channel_sessions
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on public.distribution_channel_sessions to service_role;
