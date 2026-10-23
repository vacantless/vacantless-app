-- S735: a landlord asks for a Realtor.ca listing through a partner agent
-- (Ontario), or for a local Royal LePage agent (outside Ontario). This is a
-- request a person answers, never a site the product posts to: Realtor.ca is
-- an MLS listing placed by a licensed agent under a representation agreement
-- (S594 broker answers; S710 decision: it returns only as a separate brokerage
-- request). The money, if any, moves on the brokerage rail, never through
-- Vacantless. The app only records who asked, for which rental, and how to
-- reach them, and emails the admins.

create table if not exists public.brokerage_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('realtor_ca_listing', 'local_agent')),
  province text,
  contact_name text,
  contact_phone text,
  contact_email text,
  note text,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  requested_by uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists brokerage_requests_org_idx
  on public.brokerage_requests (organization_id, created_at desc);
create index if not exists brokerage_requests_property_idx
  on public.brokerage_requests (property_id, created_at desc);

alter table public.brokerage_requests enable row level security;

create policy brokerage_requests_all on public.brokerage_requests
  for all
  using (organization_id in (select user_org_ids()))
  with check (organization_id in (select user_org_ids()));

grant select, insert, update on public.brokerage_requests to authenticated;
grant select, update on public.brokerage_requests to service_role;

comment on table public.brokerage_requests is
  'S735: landlord requests for an agent-placed Realtor.ca listing (Ontario) or a local agent referral (outside Ontario). Answered by a person; never a posting path.';
