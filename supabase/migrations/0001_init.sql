-- ============================================================================
-- Vacantless — M1 Foundation schema + multi-tenant Row-Level Security
-- ============================================================================
-- Tenant isolation model:
--   * Every tenant table carries organization_id.
--   * A SECURITY DEFINER helper, user_org_ids(), returns the org ids the
--     current auth user belongs to. Because it is SECURITY DEFINER it bypasses
--     RLS on `memberships`, which breaks the policy-recursion trap.
--   * Every table's RLS policy gates rows on: organization_id IN user_org_ids().
--   * Because "Automatically expose new tables" is OFF, we GRANT table
--     privileges to the `authenticated` role explicitly (intentional, not auto).
-- Run this whole file once in the Supabase SQL editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  slug               text unique not null,
  brand_color        text not null default '#4f46e5',
  logo_url           text,
  plan               text not null default 'trial',
  stripe_customer_id text,
  created_at         timestamptz not null default now()
);

create table if not exists public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'operator' check (role in ('owner_admin', 'operator')),
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.properties (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  address         text not null,
  rent_cents      integer,
  beds            integer,
  baths           numeric(3, 1),
  parking         text,
  status          text not null default 'available' check (status in ('available', 'leased', 'off_market')),
  description     text,
  created_at      timestamptz not null default now()
);

create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id     uuid references public.properties(id) on delete set null,
  name            text,
  email           text,
  phone           text,
  source          text,
  source_detail   text,
  status          text not null default 'new'
                    check (status in ('new', 'replied', 'contacted', 'booked', 'showed', 'applied', 'leased', 'lost')),
  notes           text,
  leased_date     date,
  created_at      timestamptz not null default now()
);

create table if not exists public.showings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id         uuid references public.leads(id) on delete cascade,
  property_id     uuid references public.properties(id) on delete set null,
  scheduled_at    timestamptz,
  outcome         text check (outcome in ('scheduled', 'attended', 'no_show', 'cancelled')),
  created_at      timestamptz not null default now()
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id         uuid references public.leads(id) on delete cascade,
  channel         text check (channel in ('email', 'sms', 'call', 'note')),
  direction       text check (direction in ('inbound', 'outbound')),
  body            text,
  created_at      timestamptz not null default now()
);

create table if not exists public.templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text check (kind in ('auto_reply', 'reminder', 'nurture', 'price_drop', 'feedback')),
  name            text not null,
  subject         text,
  body            text,
  created_at      timestamptz not null default now()
);

create table if not exists public.feedback (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  showing_id      uuid references public.showings(id) on delete cascade,
  rating          integer check (rating between 1 and 5),
  comments        text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_memberships_user on public.memberships (user_id);
create index if not exists idx_properties_org on public.properties (organization_id);
create index if not exists idx_leads_org on public.leads (organization_id);
create index if not exists idx_showings_org on public.showings (organization_id);
create index if not exists idx_messages_org on public.messages (organization_id);
create index if not exists idx_templates_org on public.templates (organization_id);
create index if not exists idx_feedback_org on public.feedback (organization_id);

-- ---------------------------------------------------------------------------
-- Helper: the org ids the current auth user belongs to.
-- SECURITY DEFINER → bypasses RLS on memberships → no policy recursion.
-- ---------------------------------------------------------------------------

create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.memberships
  where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Atomic onboarding: create an organization and make the caller its owner.
-- SECURITY DEFINER so it can insert without a permissive INSERT policy on
-- organizations. The caller must be authenticated.
-- ---------------------------------------------------------------------------

create or replace function public.create_organization(p_name text, p_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.organizations (name, slug)
  values (p_name, p_slug)
  returning * into v_org;

  insert into public.memberships (organization_id, user_id, role)
  values (v_org.id, auth.uid(), 'owner_admin');

  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table.
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.memberships  enable row level security;
alter table public.properties   enable row level security;
alter table public.leads        enable row level security;
alter table public.showings     enable row level security;
alter table public.messages     enable row level security;
alter table public.templates    enable row level security;
alter table public.feedback     enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- organizations: members can read / update their own org.
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations
  for select to authenticated
  using (id in (select public.user_org_ids()));

drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations
  for update to authenticated
  using (id in (select public.user_org_ids()))
  with check (id in (select public.user_org_ids()));

-- memberships: members can read memberships of their own org(s).
drop policy if exists membership_select on public.memberships;
create policy membership_select on public.memberships
  for select to authenticated
  using (organization_id in (select public.user_org_ids()));

-- Generic per-tenant policy on the operational tables.
-- (One block per table; identical shape gated on organization_id.)

drop policy if exists properties_all on public.properties;
create policy properties_all on public.properties
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists leads_all on public.leads;
create policy leads_all on public.leads
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists showings_all on public.showings;
create policy showings_all on public.showings
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists messages_all on public.messages;
create policy messages_all on public.messages
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists templates_all on public.templates;
create policy templates_all on public.templates
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists feedback_all on public.feedback;
create policy feedback_all on public.feedback
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants (explicit, because auto-expose of new tables is OFF).
-- RLS still governs which ROWS each authenticated user can touch.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select, update on public.organizations to authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update, delete on public.properties to authenticated;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert, update, delete on public.showings to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.templates to authenticated;
grant select, insert, update, delete on public.feedback to authenticated;

grant execute on function public.user_org_ids() to authenticated;
grant execute on function public.create_organization(text, text) to authenticated;
