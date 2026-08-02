-- ============================================================================
-- 0204_organization_onboarding - dashboard getting-started wizard state
--
-- Stores only operator choices that cannot be derived from live org data.
-- Property and tenancy completion are derived from their source tables.
-- ============================================================================

create table if not exists public.organization_onboarding (
  organization_id    uuid primary key references public.organizations(id) on delete cascade,
  dismissed_at       timestamptz,
  rail_step_done_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.organization_onboarding enable row level security;

drop policy if exists organization_onboarding_select on public.organization_onboarding;
create policy organization_onboarding_select on public.organization_onboarding
  for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists organization_onboarding_insert on public.organization_onboarding;
create policy organization_onboarding_insert on public.organization_onboarding
  for insert
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists organization_onboarding_update on public.organization_onboarding;
create policy organization_onboarding_update on public.organization_onboarding
  for update
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update on public.organization_onboarding to authenticated;
grant select, insert, update, delete on public.organization_onboarding to service_role;
