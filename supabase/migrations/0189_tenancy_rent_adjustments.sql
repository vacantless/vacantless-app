-- ============================================================================
-- 0189_tenancy_rent_adjustments — append-only current-rent confirmation ledger
--
-- Existing-lease onboarding can OCR or carry the ORIGINAL lease rent even when
-- the tenant's current effective rent has shifted. This table stores the
-- reconstructable chain: original lease rent -> every confirmed change ->
-- current effective rent. The flat tenancies.rent_cents remains the read model
-- that the rent-increase engine/N1 path already consumes.
--
-- Append-only by privilege/RLS shape: dashboard users can SELECT and INSERT
-- rows scoped to their org. Corrections are new rows with kind='correction';
-- there is no authenticated UPDATE/DELETE path for prior amounts.
-- ============================================================================

create table if not exists public.tenancy_rent_adjustments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenancy_id      uuid not null references public.tenancies(id) on delete cascade,

  effective_date  date not null,
  rent_cents      integer not null check (rent_cents > 0),
  kind            text not null check (
                    kind in (
                      'original',
                      'increase',
                      'reduction',
                      'altered_term',
                      'correction'
                    )
                  ),
  source          text not null check (
                    source in (
                      'lease_ocr',
                      'landlord_confirm',
                      'n1',
                      'import'
                    )
                  ),
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null
);

create index if not exists tenancy_rent_adjustments_org_idx
  on public.tenancy_rent_adjustments(organization_id);
create index if not exists tenancy_rent_adjustments_tenancy_effective_idx
  on public.tenancy_rent_adjustments(tenancy_id, effective_date desc, created_at desc);

comment on table public.tenancy_rent_adjustments is
  'Append-only per-tenancy rent ledger: original lease rent plus confirmed increases/reductions/corrections. Latest effective row is synced to tenancies.rent_cents.';
comment on column public.tenancy_rent_adjustments.effective_date is
  'Date this rent amount became effective. The current rent is the latest effective_date, tie-broken by created_at.';
comment on column public.tenancy_rent_adjustments.kind is
  'original, increase, reduction, altered_term, or correction. Corrections append a new row instead of editing prior amounts.';
comment on column public.tenancy_rent_adjustments.source is
  'lease_ocr, landlord_confirm, n1, or import provenance for the row.';

alter table public.tenancy_rent_adjustments enable row level security;

drop policy if exists tenancy_rent_adjustments_select on public.tenancy_rent_adjustments;
create policy tenancy_rent_adjustments_select on public.tenancy_rent_adjustments
  for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists tenancy_rent_adjustments_insert on public.tenancy_rent_adjustments;
create policy tenancy_rent_adjustments_insert on public.tenancy_rent_adjustments
  for insert
  with check (organization_id in (select public.user_org_ids()));

grant select, insert on public.tenancy_rent_adjustments to authenticated;
grant select, insert on public.tenancy_rent_adjustments to service_role;
