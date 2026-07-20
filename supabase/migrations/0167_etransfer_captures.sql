-- 0167_etransfer_captures.sql -- pending Interac e-Transfer email captures.
--
-- Additive only. A forwarded Interac e-Transfer notification can create a
-- review-before-confirm row after the existing inbound email trust gates pass.
-- It never writes rent_payments or expenses from the webhook. The operator must
-- confirm or dismiss the pending row in the dashboard.

create table if not exists public.etransfer_captures (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,

  source                 text not null default 'email'
                           check (source in ('email')),
  direction              text not null
                           check (direction in ('received','sent')),
  counterparty_name      text not null,
  amount_cents           int not null check (amount_cents > 0),
  txn_date               date not null,

  suggested_tenancy_id   uuid references public.tenancies(id) on delete set null,
  suggested_category     text
                           check (
                             suggested_category is null or
                             suggested_category in (
                               'mortgage','property_tax','insurance','utilities',
                               'maintenance','management','interest','condo_fees',
                               'supplies','professional','advertising','travel','other'
                             )
                           ),
  suggested_property_id  uuid references public.properties(id) on delete set null,
  suggested_building_key text,

  status                 text not null default 'pending'
                           check (status in ('pending','confirmed','dismissed')),
  rent_payment_id        uuid references public.rent_payments(id) on delete set null,
  expense_id             uuid references public.expenses(id) on delete set null,

  -- SHA-256 from lib/etransfer-ingest. Never stores raw provider message-id,
  -- raw body, or raw headers.
  dedupe_key             text not null,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  confirmed_at           timestamptz,
  dismissed_at           timestamptz,

  constraint etransfer_captures_suggestion_scope_chk
    check (suggested_property_id is null or suggested_building_key is null)
);

create unique index if not exists etransfer_captures_org_dedupe_uq
  on public.etransfer_captures(organization_id, dedupe_key);

create index if not exists etransfer_captures_org_status_idx
  on public.etransfer_captures(organization_id, status, created_at desc);

create index if not exists etransfer_captures_tenancy_idx
  on public.etransfer_captures(suggested_tenancy_id);

create index if not exists etransfer_captures_expense_idx
  on public.etransfer_captures(expense_id);

alter table public.etransfer_captures enable row level security;

drop policy if exists etransfer_captures_all on public.etransfer_captures;
create policy etransfer_captures_all on public.etransfer_captures
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.etransfer_captures to authenticated;
grant select, insert, update, delete on public.etransfer_captures to service_role;
