-- 0325_nsf_charges.sql
-- S835c: when a tenant's rent debit fails, the landlord pays a fee (Stripe
-- CA$5.00). Two records, both Noam's ask (2026-11-23):
--   1. the fee as an expense on the rental, recorded by Vacantless (its note
--      says so; expenses.source stays 'manual', so no change to that table);
--   2. an NSF charge on the tenancy: what the bank charged plus an optional
--      admin charge the landlord may pass on to the tenant. Editable. Ontario
--      caps the admin charge at $20 (O. Reg. 516/06, s. 17); the cap is
--      enforced here too. Vacantless never debits it: it is a record.
-- Rule 431: grants for the new table are in this file, service_role included.

create table if not exists public.tenancy_nsf_charges (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  tenancy_id          uuid not null references public.tenancies(id) on delete cascade,
  incurred_on         date not null,
  bank_charge_cents   integer not null default 0 check (bank_charge_cents >= 0 and bank_charge_cents <= 100000),
  admin_charge_cents  integer not null default 0 check (admin_charge_cents >= 0 and admin_charge_cents <= 2000),
  note                text,
  -- 'stripe' = recorded from a failed Stripe debit; 'manual' = typed by the landlord.
  source              text not null default 'manual' check (source in ('stripe', 'manual')),
  -- One charge per failed Stripe invoice (a retry of the same invoice adds nothing).
  stripe_invoice_id   text unique,
  expense_id          uuid references public.expenses(id) on delete set null,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists tenancy_nsf_charges_tenancy_idx on public.tenancy_nsf_charges (tenancy_id, incurred_on desc);

alter table public.tenancy_nsf_charges enable row level security;

create policy tenancy_nsf_charges_all on public.tenancy_nsf_charges
  for all
  using (organization_id in (select user_org_ids()))
  with check (organization_id in (select user_org_ids()));

-- Same two-step rule every account table carries (0300).
create policy two_step_required on public.tenancy_nsf_charges
  as restrictive for all to authenticated
  using ((select public.two_step_ok()))
  with check ((select public.two_step_ok()));

revoke all on public.tenancy_nsf_charges from anon;
grant select, insert, update, delete on public.tenancy_nsf_charges to authenticated;
grant select, insert, update, delete on public.tenancy_nsf_charges to service_role;
