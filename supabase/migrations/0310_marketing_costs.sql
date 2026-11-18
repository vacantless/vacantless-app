-- 0310 (S818c): what a landlord paid each rental site, so Reports can show
-- cost per renter and per booked viewing by site. Noam 2026-11-18 ("we need to
-- know which to boost or spend money on between our channels", then "go").
-- Entered by the landlord; the robot's own paid-ad ledger
-- (distribution_channel_spend) stays separate. Grants in this file (rule 431).
create table if not exists public.marketing_costs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  portal          text not null,
  label           text,
  amount_cents    integer not null check (amount_cents > 0 and amount_cents <= 10000000),
  spent_on        date not null default current_date,
  note            text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists marketing_costs_org_spent_idx on public.marketing_costs (organization_id, spent_on desc);

alter table public.marketing_costs enable row level security;

drop policy if exists marketing_costs_member_all on public.marketing_costs;
create policy marketing_costs_member_all on public.marketing_costs
  for all to authenticated
  using (organization_id in (select organization_id from public.memberships where user_id = auth.uid()))
  with check (organization_id in (select organization_id from public.memberships where user_id = auth.uid()));

grant select, insert, update, delete on public.marketing_costs to authenticated;
grant select, insert, update, delete on public.marketing_costs to service_role;
revoke all on public.marketing_costs from anon;
