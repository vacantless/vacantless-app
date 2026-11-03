-- S748d: lists that stay right at 300+ units (the S742 review, engineering
-- item 5). The database answers at most 1,000 rows per request, so a page
-- that downloads every lead or photo row to count them silently undercounts
-- once an account passes 1,000 rows. property_rollups counts in the database.
-- security invoker: it runs as the signed-in user, so row-level security
-- still limits it to the user's own accounts.
create or replace function public.property_rollups(p_org uuid)
returns table (property_id uuid, leads bigint, photos bigint, tenancies bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    (select count(*) from public.leads l where l.property_id = p.id and l.organization_id = p_org),
    (select count(*) from public.property_photos ph where ph.property_id = p.id),
    (select count(*) from public.tenancies t where t.property_id = p.id)
  from public.properties p
  where p.organization_id = p_org;
$$;
revoke all on function public.property_rollups(uuid) from public, anon;
grant execute on function public.property_rollups(uuid) to authenticated, service_role;

-- Indexes the bounded list queries lean on.
create index if not exists leads_property_id_idx on public.leads (property_id);
create index if not exists showings_org_scheduled_idx on public.showings (organization_id, scheduled_at);
create index if not exists bank_transactions_org_posted_idx on public.bank_transactions (organization_id, posted_on desc);
create index if not exists expenses_bank_txn_idx on public.expenses (bank_transaction_id) where bank_transaction_id is not null;
