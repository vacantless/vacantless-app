-- ============================================================================
-- 0058_bank_feed — the bank-feed expense module, Slice 2 foundation (S311). See
-- VACANTLESS-BANK-FEED-DECISION-2026-06-22.md.
--
-- The work-order module (0054) records the owner's MAINTENANCE spend. This adds
-- the other half of the owner's expense picture — EVERY property cost (mortgage,
-- property tax, utilities, insurance, ...) captured straight off the owner's bank
-- + card feed the way FreshBooks does. An aggregator (Plaid for Growth, Flinks
-- for Premium — see lib/bank-feed) connects the accounts; transactions land in a
-- staging ledger; the owner triages each onto a unit / building + category, which
-- creates an `expenses` row. That row is shaped to roll up through the EXISTING
-- owner statement (lib/statements.ts) with no new reporting code.
--
-- *** We never store bank CREDENTIALS. *** The aggregator holds the login; we
-- store only its opaque connection handle (Plaid item_id / Flinks login_id) and,
-- separately, the access token needed to pull — in bank_connection_secrets, which
-- is service_role-only (NO authenticated grant), so the dashboard never reads it
-- and only the server-side sync (service_role) can. Read-only data; we never move
-- money — same "we record, we don't process" discipline as the rent rail (0032)
-- and the work-order module (0054).
--
-- Four tables:
--   * bank_connections        — one connected institution per org (status, last
--                               sync). Dashboard-readable; NO secrets here.
--   * bank_connection_secrets — the pull token, service_role-only. Split out so a
--                               column-level secret never rides on a row the
--                               authenticated dashboard can read (RLS gates rows,
--                               not columns).
--   * bank_transactions       — the staging ledger: normalized transactions +
--                               triage status. A debit is an expense candidate.
--   * expenses                — sibling of work_orders: a property cost attached
--                               to exactly ONE level (unit XOR building) + a
--                               category, shaped like WorkOrderCostRow so it feeds
--                               the statement rollup. Mirrors the 0057 scope CHECK.
--
-- Conventions mirror 0054 / 0055: free-ish text + CHECK whitelist (not a pg enum);
-- per-org RLS gated on organization_id in (select public.user_org_ids()); explicit
-- grants because auto-expose of new tables is OFF; service_role gets DML for the
-- sync/cron path (avoids the silent permission-denied trap, 0007).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- bank_connections — one connected institution (Plaid item / Flinks login).
-- ---------------------------------------------------------------------------
create table if not exists public.bank_connections (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,

  provider          text not null check (provider in ('plaid','flinks')),
  -- the aggregator's opaque connection handle (Plaid item_id / Flinks login_id).
  -- NOT a credential, NOT the pull token (that lives in bank_connection_secrets).
  external_id       text not null,
  institution_name  text,
  status            text not null default 'active'
                      check (status in ('active','reauth_required','disconnected','error')),
  last_synced_at    timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- one row per (org, provider, connection) — the natural dedupe key on re-link.
  unique (organization_id, provider, external_id)
);

create index if not exists bank_connections_org_idx on public.bank_connections(organization_id);

-- ---------------------------------------------------------------------------
-- bank_connection_secrets — the pull token, service_role ONLY.
-- A separate table (not a column on bank_connections) so the secret can never be
-- read by the authenticated dashboard: RLS gates rows not columns, so the only
-- airtight way to hide a secret column is to put it in a table with no
-- authenticated grant at all. The token-exchange + nightly sync run as
-- service_role and are the only things that touch it.
-- ---------------------------------------------------------------------------
create table if not exists public.bank_connection_secrets (
  connection_id   uuid primary key references public.bank_connections(id) on delete cascade,
  -- aggregator access token (Plaid access_token / Flinks equivalent). Sensitive.
  access_token    text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- bank_transactions — the staging ledger.
-- amount_cents is the absolute value; `direction` carries the sign. A 'debit'
-- (money out) is an expense candidate; a 'credit' (money in, e.g. rent) is kept
-- for completeness but is not surfaced as an expense to triage.
-- ---------------------------------------------------------------------------
create table if not exists public.bank_transactions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  connection_id       uuid not null references public.bank_connections(id) on delete cascade,

  -- the aggregator's transaction id — the dedupe key across re-syncs.
  external_id         text not null,
  account_external_id text,
  account_name        text,

  posted_on           date not null,
  amount_cents        integer not null check (amount_cents >= 0),  -- absolute; sign in `direction`
  direction           text not null check (direction in ('debit','credit')),
  merchant            text,
  description         text,
  raw_category        text,           -- the aggregator's generic category, advisory only
  currency            text not null default 'CAD',

  triage_status       text not null default 'pending'
                        check (triage_status in ('pending','assigned','ignored')),
  -- set when the owner triages a debit into an expense (below). on delete set null
  -- so deleting the expense reopens the transaction rather than erasing it.
  expense_id          uuid,

  created_at          timestamptz not null default now(),

  unique (connection_id, external_id)
);

create index if not exists bank_transactions_org_idx     on public.bank_transactions(organization_id);
create index if not exists bank_transactions_conn_idx    on public.bank_transactions(connection_id);
create index if not exists bank_transactions_triage_idx  on public.bank_transactions(organization_id, triage_status);

-- ---------------------------------------------------------------------------
-- expenses — sibling of work_orders. A property cost at exactly ONE level.
-- Shaped to map to WorkOrderCostRow (lib/work-orders.ts): property_id / building_key
-- / category / amount_cents / incurred_on feed groupCostBy* + buildOwnerStatement.
-- The 0057 scope discipline is mirrored here: property_id XOR building_key, never
-- both (unit-scoped vs building-shared vs unscoped overhead).
-- ---------------------------------------------------------------------------
create table if not exists public.expenses (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,

  -- exactly-one-of scope, same as work_orders (work_orders_scope_chk, 0057):
  --   unit-scoped     property_id set,  building_key null
  --   building-shared property_id null, building_key set
  --   unscoped        both null
  property_id         uuid references public.properties(id) on delete set null,
  building_key        text,

  category            text not null default 'other'
                        check (category in ('mortgage','property_tax','insurance','utilities',
                                            'maintenance','management','interest','condo_fees',
                                            'supplies','professional','advertising','travel','other')),
  amount_cents        integer not null check (amount_cents >= 0),
  incurred_on         date not null,             -- the expense date (= txn posted_on for bank-fed)
  merchant            text,
  note                text,

  -- provenance: where this expense came from.
  source              text not null default 'manual'
                        check (source in ('manual','bank','import')),
  -- the staged transaction this was created from (bank source). on delete set null.
  bank_transaction_id uuid references public.bank_transactions(id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint expenses_scope_chk check (property_id is null or building_key is null)
);

create index if not exists expenses_org_idx          on public.expenses(organization_id);
create index if not exists expenses_property_idx     on public.expenses(property_id);
create index if not exists expenses_building_key_idx on public.expenses(organization_id, building_key);
create index if not exists expenses_incurred_idx     on public.expenses(organization_id, incurred_on);

-- Now that expenses exists, point bank_transactions.expense_id at it (set null so
-- deleting an expense reopens the staged transaction, never erases it). Guarded
-- so the migration is idempotent (ADD CONSTRAINT has no IF NOT EXISTS).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bank_transactions_expense_fk') then
    alter table public.bank_transactions
      add constraint bank_transactions_expense_fk
      foreign key (expense_id) references public.expenses(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — per-org for the three dashboard tables; secrets table is locked down.
-- ---------------------------------------------------------------------------
alter table public.bank_connections        enable row level security;
alter table public.bank_connection_secrets enable row level security;
alter table public.bank_transactions       enable row level security;
alter table public.expenses                enable row level security;

drop policy if exists bank_connections_all on public.bank_connections;
create policy bank_connections_all on public.bank_connections
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists bank_transactions_all on public.bank_transactions;
create policy bank_transactions_all on public.bank_transactions
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists expenses_all on public.expenses;
create policy expenses_all on public.expenses
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- bank_connection_secrets: RLS enabled with NO policy for authenticated, so even
-- with a stray grant the authenticated role can match no rows. Belt-and-braces
-- with the grant omission below.

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF).
--   * dashboard tables: authenticated + service_role.
--   * secrets: service_role ONLY (the dashboard must never read the pull token).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.bank_connections  to authenticated;
grant select, insert, update, delete on public.bank_connections  to service_role;

grant select, insert, update, delete on public.bank_transactions to authenticated;
grant select, insert, update, delete on public.bank_transactions to service_role;

grant select, insert, update, delete on public.expenses          to authenticated;
grant select, insert, update, delete on public.expenses          to service_role;

-- secrets: service_role only. NO grant to authenticated by design.
grant select, insert, update, delete on public.bank_connection_secrets to service_role;
