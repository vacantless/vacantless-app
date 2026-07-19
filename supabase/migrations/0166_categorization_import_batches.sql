-- 0166_categorization_import_batches.sql -- staged accounting-history import.
--
-- Additive only. This creates review-before-commit staging for categorized
-- accounting exports such as FreshBooks CSV. It does not alter any existing
-- ledger table, does not create bank_transactions, and does not file anything
-- until a gated server action commits reviewed rows.

create table if not exists public.categorization_import_batches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source          text not null default 'freshbooks',
  filename        text,
  row_count       int not null default 0,
  status          text not null default 'staged'
                    check (status in ('staged','committed','discarded')),
  created_by      uuid,
  created_at      timestamptz default now(),
  committed_at    timestamptz
);

create table if not exists public.categorization_import_rows (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  batch_id               uuid not null references public.categorization_import_batches(id) on delete cascade,
  row_no                 int,
  txn_date               date,
  amount_cents           int,
  direction              text check (direction in ('debit','credit')),
  description            text,
  source_category        text,
  client_tag             text,
  matched_transaction_id uuid references public.bank_transactions(id) on delete set null,
  planned_action         text,
  planned_category       text,
  planned_property_id    uuid references public.properties(id) on delete set null,
  planned_building_key   text,
  status                 text not null default 'pending'
                           check (status in ('pending','applied','skipped')),
  applied_ref            text,
  created_at             timestamptz default now()
);

create index if not exists categorization_import_batches_org_idx
  on public.categorization_import_batches(organization_id, status, created_at desc);

create index if not exists categorization_import_rows_batch_idx
  on public.categorization_import_rows(organization_id, batch_id);

create index if not exists categorization_import_rows_status_idx
  on public.categorization_import_rows(organization_id, status);

alter table public.categorization_import_batches enable row level security;
alter table public.categorization_import_rows enable row level security;

drop policy if exists categorization_import_batches_all on public.categorization_import_batches;
create policy categorization_import_batches_all on public.categorization_import_batches
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists categorization_import_rows_all on public.categorization_import_rows;
create policy categorization_import_rows_all on public.categorization_import_rows
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.categorization_import_batches to authenticated;
grant select, insert, update, delete on public.categorization_import_batches to service_role;

grant select, insert, update, delete on public.categorization_import_rows to authenticated;
grant select, insert, update, delete on public.categorization_import_rows to service_role;
