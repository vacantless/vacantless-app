-- ============================================================================
-- 0028_tenancies — the post-lease tenant/tenancy record (platform pivot, S209)
--
-- The product previously stopped at "leased" (a lead.status). This adds the
-- first PROPERTY-MANAGEMENT entity: a tenancy ties a unit to its current
-- tenant(s), the signed rent, dates, and lease terms. It is the foundation
-- both rent collection (Rotessa) and tenant communications build on.
--
-- Design (locked S209):
--   * tenancies — one row per lease: property (unit) + money + dates + status
--     + the convert-review fields (deposit / payment notes / move-in notes).
--     Optional lead_id traces back to the leased lead it converted from.
--   * tenants — child table, 1..n rows per tenancy (co-tenants / roommates).
--     is_primary marks the lead tenant = the future Rotessa payer (one PAD
--     schedule per tenancy charges the primary).
--
-- Conventions mirror the per-org tables in 0001: RLS gates rows on
-- organization_id in (select public.user_org_ids()); explicit grants because
-- "auto-expose new tables" is OFF. service_role gets DML too so the upcoming
-- Rotessa nightly poll cron (runs as service_role) won't hit permission-denied
-- (the silent-empty-read trap from migration 0007).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. tenancies — one per lease.
-- ---------------------------------------------------------------------------
create table if not exists public.tenancies (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id     uuid not null references public.properties(id)    on delete restrict,
  -- traceability back to the leased lead this was converted from (nullable;
  -- a tenancy can also be created standalone for an already-occupied unit).
  lead_id         uuid references public.leads(id) on delete set null,

  -- money (prefilled from properties.rent_cents at convert-time, editable)
  rent_cents      integer check (rent_cents is null or rent_cents >= 0),
  deposit_cents   integer check (deposit_cents is null or deposit_cents >= 0),

  -- dates + term
  start_date      date not null,
  end_date        date,
  term_months     integer check (term_months is null or term_months > 0),  -- null = month-to-month

  status          text not null default 'active'
                    check (status in ('upcoming', 'active', 'ended')),

  -- convert-review free-text
  payment_notes   text,   -- deposit / PAD / payment arrangement notes
  move_in_notes   text,
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint tenancies_end_after_start
    check (end_date is null or end_date >= start_date)
);

create index if not exists tenancies_org_idx       on public.tenancies(organization_id);
create index if not exists tenancies_property_idx  on public.tenancies(property_id);
create index if not exists tenancies_lead_idx      on public.tenancies(lead_id);
create index if not exists tenancies_status_idx    on public.tenancies(organization_id, status);

-- ---------------------------------------------------------------------------
-- 2. tenants — co-tenants on a tenancy (1..n).
--    organization_id is denormalized so RLS can gate without a join to the
--    parent (matches the project's flat per-org policy pattern).
-- ---------------------------------------------------------------------------
create table if not exists public.tenants (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenancy_id      uuid not null references public.tenancies(id)     on delete cascade,
  name            text,
  email           text,
  phone           text,
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists tenants_org_idx      on public.tenants(organization_id);
create index if not exists tenants_tenancy_idx  on public.tenants(tenancy_id);

-- At most one primary tenant per tenancy (the Rotessa payer).
create unique index if not exists tenants_one_primary_per_tenancy
  on public.tenants(tenancy_id) where is_primary;

-- ---------------------------------------------------------------------------
-- 3. RLS — per-org, same shape as the operational tables in 0001.
-- ---------------------------------------------------------------------------
alter table public.tenancies enable row level security;
alter table public.tenants   enable row level security;

drop policy if exists tenancies_all on public.tenancies;
create policy tenancies_all on public.tenancies
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists tenants_all on public.tenants;
create policy tenants_all on public.tenants
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- 4. Grants — explicit (auto-expose of new tables is OFF). authenticated for
--    the dashboard; service_role for the future rent-collection cron.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.tenancies to authenticated;
grant select, insert, update, delete on public.tenants   to authenticated;
grant select, insert, update, delete on public.tenancies to service_role;
grant select, insert, update, delete on public.tenants   to service_role;
