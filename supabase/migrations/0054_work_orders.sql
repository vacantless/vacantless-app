-- ============================================================================
-- 0054_work_orders — maintenance work orders + the owner's own trade rolodex
-- (platform pivot, the self-managed-owner wedge keystone, S304)
--
-- The pitch behind this table: a hands-on owner (the Abbas archetype) keeps his
-- OWN trades — roofer, HVAC, plumber — and pays a property manager 8% mostly for
-- communications + tracking. This module is the tracking half: a maintenance
-- issue becomes a WORK ORDER the owner assigns to one of THEIR OWN trade
-- contacts, moves through a status lifecycle, and attaches a cost to. We never
-- dispatch a trade and never move money — we record the owner's work, the same
-- way 0032 rent_payments records the owner's rent receipts. That keeps us out of
-- money-services territory and consistent with the "we record, we don't process"
-- discipline of the rent rail.
--
-- Two tables:
--   * trade_contacts — the owner's vendor rolodex (per-org). The people the
--     owner already uses; assignable to work orders. `archived` soft-hides a
--     vendor without breaking the cost history of past jobs.
--   * work_orders — one tracked job. Optionally tied to a property and/or a
--     tenancy (both `on delete set null`, NOT cascade, so deleting a unit or
--     ending a tenancy never erases the job's cost — that cost belongs in the
--     owner's year-end numbers). trade_contact_id is also set-null so archiving
--     /deleting a vendor keeps the job.
--
-- The `status` / `category` / `priority` columns follow the rent_payments.method
-- pattern: free-ish text with a CHECK whitelist (NOT a Postgres enum) so adding
-- a state/category later is a one-line CHECK change, not an ALTER TYPE.
--
-- cost_cents (integer cents, >= 0, nullable until known) is deliberately shaped
-- to feed the future owner financial-statement / year-end reconciliation export
-- (rent-in from 0032 minus maintenance-out from here, per property per period).
--
-- Conventions mirror the per-org tables in 0001 + 0028 + 0032: RLS gates rows on
-- organization_id in (select public.user_org_ids()); explicit grants because
-- "auto-expose new tables" is OFF; service_role gets DML too so the future
-- export/reconcile cron won't hit the silent permission-denied trap (0007).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- trade_contacts — the owner's own vendor rolodex
-- ---------------------------------------------------------------------------
create table if not exists public.trade_contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  name            text not null,
  trade_type      text,            -- free text: 'Plumber', 'Roofer', 'HVAC', ...
  phone           text,
  email           text,
  note            text,
  archived        boolean not null default false,

  created_at      timestamptz not null default now()
);

create index if not exists trade_contacts_org_idx on public.trade_contacts(organization_id);

-- ---------------------------------------------------------------------------
-- work_orders — a tracked maintenance job
-- ---------------------------------------------------------------------------
create table if not exists public.work_orders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id)  on delete cascade,
  -- set-null (NOT cascade): the job's cost history outlives the unit/tenancy/vendor.
  property_id      uuid references public.properties(id)     on delete set null,
  tenancy_id       uuid references public.tenancies(id)      on delete set null,
  trade_contact_id uuid references public.trade_contacts(id) on delete set null,

  title           text not null,
  description     text,
  category        text not null default 'general'
                    check (category in ('plumbing','electrical','hvac','appliance',
                                        'structural','pest','landscaping','cleaning','general')),
  priority        text not null default 'normal'
                    check (priority in ('low','normal','high','urgent')),
  status          text not null default 'open'
                    check (status in ('open','assigned','in_progress','completed','cancelled')),

  cost_cents      integer check (cost_cents is null or cost_cents >= 0),
  reported_on     date not null default current_date,
  scheduled_for   date,
  completed_on    date,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists work_orders_org_idx      on public.work_orders(organization_id);
create index if not exists work_orders_tenancy_idx  on public.work_orders(tenancy_id);
create index if not exists work_orders_property_idx on public.work_orders(property_id);
create index if not exists work_orders_status_idx   on public.work_orders(organization_id, status);

-- ---------------------------------------------------------------------------
-- RLS — per-org, same shape as the operational tables in 0001 / 0028 / 0032.
-- ---------------------------------------------------------------------------
alter table public.trade_contacts enable row level security;
alter table public.work_orders   enable row level security;

drop policy if exists trade_contacts_all on public.trade_contacts;
create policy trade_contacts_all on public.trade_contacts
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists work_orders_all on public.work_orders;
create policy work_orders_all on public.work_orders
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard; service_role for the future financial-statement/export cron.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.trade_contacts to authenticated;
grant select, insert, update, delete on public.trade_contacts to service_role;
grant select, insert, update, delete on public.work_orders   to authenticated;
grant select, insert, update, delete on public.work_orders   to service_role;
