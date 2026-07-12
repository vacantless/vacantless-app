-- ============================================================================
-- 0140_notices — generic LTB notice library (N-form) table. First form: N4.
--
-- Generalizes the per-tenancy n1_* snapshot pattern (0132/0134) into ONE table so
-- termination + other notices (N4 first, then N5/N12/N13) don't each sprout their
-- own tenancy columns. Same invariants as the N1 lane: a served notice renders
-- from an IMMUTABLE snapshot frozen at serve time (served/billed/filed = immutable,
-- KI731/733/734), keyed by a public service_token (the Slice B/C /notice/[token]
-- route reads only a served snapshot).
--
-- Slice A ships the TABLE ONLY (prepare-first; no serve-on-behalf yet). The N4
-- official-PDF fill + operator serve flow land in Slices B/C behind the
-- legal-verify gate (N-FORM-LIBRARY-DESIGN-2026-07-12.md section 6). Additive +
-- org-scoped RLS (organization_id IN user_org_ids()). Reversible (drop the table).
-- ============================================================================

create table if not exists public.notices (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  tenancy_id         uuid not null references public.tenancies(id) on delete cascade,
  type               text not null check (type in ('N1', 'N4', 'N5', 'N12', 'N13')),
  status             text not null default 'draft'
                       check (status in ('draft', 'served', 'void', 'filed')),
  -- Immutable frozen inputs at serve time (parties, address, arrears rows,
  -- termination date, amounts). Empty for a draft; populated when served.
  snapshot           jsonb not null default '{}'::jsonb,
  -- Denormalized for listing/sorting without opening the snapshot.
  termination_date   date,
  total_owing_cents  integer,
  service_token      uuid not null default gen_random_uuid(),
  served_at          timestamptz,
  served_method      text,
  filed_document_id  uuid references public.documents(id) on delete set null,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists idx_notices_service_token
  on public.notices(service_token);
create index if not exists idx_notices_tenancy
  on public.notices(tenancy_id);
create index if not exists idx_notices_org
  on public.notices(organization_id);

alter table public.notices enable row level security;
drop policy if exists notices_all on public.notices;
create policy notices_all on public.notices
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));
grant select, insert, update, delete on public.notices to authenticated;

comment on table public.notices is
  'Generic LTB notice library (N-form) records. One row per prepared/served notice; snapshot is the immutable frozen inputs at serve time, rendered by the public /notice/[token] route (Slice B/C). N4 (arrears termination) first; the N1 lane may migrate here later. Org-scoped RLS; prepare-first until the per-form legal-verify gate opens serve-on-behalf.';
