-- ============================================================================
-- 0039_lease_clauses — clause library + per-clause versioning + lease documents
--   (platform pivot: teardown entry #11, the lease vault — Premium moat slice 1)
--
-- The competitive teardown (VACANTLESS-LEASE-VAULT-MODULE-BRIEF-2026-06-17.md)
-- settled that Ontario forms + e-sign + per-person storage are all PARITY now
-- (Tenon10 ships them free), so they cannot anchor Premium. The ONE durable
-- differentiator the teardown left OPEN is CLAUSE-LEVEL versioning: tracking
-- which exact clause wording was in force on which lease, diffing versions, and
-- rolling forward at renewal. No competitor versions clauses. This migration is
-- the data layer for that.
--
-- It generalizes the seed already proven in Noam's docusign-automation project
-- (f121-clauses.json + the make-offer-prefill.js assembler: stable clause IDs,
-- {{placeholder}} interpolation, applicable_to scoping, assemble-by-ID-into-a-
-- doc). The one thing that project does NOT do is per-clause versioning — its
-- `version` is a single file-level field. Here every clause carries its own
-- version history, and an executed lease snapshots the exact version used.
--
-- Three tables:
--
--   lease_clauses — the org clause LIBRARY. One row per logical clause (pets,
--     parking, smoking, utilities, storage, ...). Identified per-org by a stable
--     `key` (the analogue of f121's clause IDs). `applicable_to` scopes a clause
--     to residential / commercial / both (the analogue of f121's freehold|condo|
--     both). The clause row carries no body — bodies live in versions.
--
--   lease_clause_versions — per-clause VERSION HISTORY (the moat). Each row is
--     one immutable version of a clause's body (with {{token}} placeholders the
--     assembler substitutes). Exactly one version per clause is `is_current`
--     (partial-unique index; reassign via clear-then-set, never one UPDATE — the
--     one-designated-child rule). `version` is a monotonic integer per clause.
--     The residential seed is authored in lib/clauses.ts (RESIDENTIAL_CLAUSE_SEED,
--     single source of truth) and inserted as version 1 at org onboarding; Noam
--     later swaps his real DocuSign/SkySlope additional-terms language in as
--     version 2, which exercises the versioning path end to end.
--
--   lease_documents — an assembled/executed lease. `assembled_body` is the
--     joined clause text at generation time; `executed_clause_versions` is the
--     jsonb SNAPSHOT (which clause_id + version_id + version + body was in force)
--     — the Pillar-B "executed lease records exactly which clause version was in
--     force" requirement, and the anchor the renewal diff reads against.
--
-- Conventions mirror 0028 / 0033: CHECK (not a pg enum) so whitelists extend in
-- one line; RLS gates on organization_id in (select public.user_org_ids());
-- explicit grants because auto-expose of new tables is OFF; service_role gets
-- DML too (a future signing-callback / renewal cron won't hit the silent
-- permission-denied trap — the 0007 lesson). organization_id is denormalized
-- onto the child tables so RLS gates without a join.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- lease_clauses — the org clause library (logical clause; no body here)
-- ---------------------------------------------------------------------------
create table if not exists public.lease_clauses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- stable per-org identifier (e.g. 'pets', 'parking'). The assembler selects
  -- by key; renewal diffs match by key. Unique per org (see index below).
  key             text not null,
  title           text not null,
  -- loose grouping for the library UI (e.g. 'occupancy', 'amenities',
  -- 'conduct', 'financial'). Free text — no CHECK so orgs can add their own.
  category        text not null default 'general',
  -- scope: which lease type this clause belongs in. 'both' = residential + commercial.
  applicable_to   text not null default 'both'
                    check (applicable_to in ('residential', 'commercial', 'both')),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists lease_clauses_org_idx
  on public.lease_clauses(organization_id);
-- one clause per (org, key) — the stable-ID guarantee the assembler relies on.
create unique index if not exists uq_lease_clauses_org_key
  on public.lease_clauses(organization_id, key);

-- ---------------------------------------------------------------------------
-- lease_clause_versions — per-clause version history (the differentiator)
-- ---------------------------------------------------------------------------
create table if not exists public.lease_clause_versions (
  id              uuid primary key default gen_random_uuid(),
  -- denormalized so RLS gates without joining lease_clauses.
  organization_id uuid not null references public.organizations(id) on delete cascade,
  clause_id       uuid not null references public.lease_clauses(id) on delete cascade,

  -- monotonic per clause: 1, 2, 3, ... (app assigns next = max+1).
  version         integer not null,
  -- the clause text, with {{token}} placeholders the assembler substitutes.
  body            text not null,
  -- exactly one version per clause is current (partial-unique index below).
  is_current      boolean not null default false,
  -- optional changelog note for this version ("Bill 60 update", "added vaping").
  note            text,

  -- the acting member (auth.users id); set null (not cascade) so the version
  -- record survives the author being removed — it's an immutable legal artifact.
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists lease_clause_versions_org_idx
  on public.lease_clause_versions(organization_id);
create index if not exists lease_clause_versions_clause_idx
  on public.lease_clause_versions(clause_id, version desc);
-- a clause can't have two rows at the same version number.
create unique index if not exists uq_lease_clause_versions_clause_version
  on public.lease_clause_versions(clause_id, version);
-- at most one CURRENT version per clause (the one-designated-child invariant;
-- reassign via clear-then-set — two writes — never a single UPDATE).
create unique index if not exists uq_lease_clause_versions_one_current
  on public.lease_clause_versions(clause_id)
  where is_current;

-- ---------------------------------------------------------------------------
-- lease_documents — an assembled / executed lease (anchors the snapshot)
-- ---------------------------------------------------------------------------
create table if not exists public.lease_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- the tenancy this lease is for. set null (not cascade) so the executed lease
  -- — a permanent legal record — survives the tenancy being removed later.
  tenancy_id      uuid references public.tenancies(id) on delete set null,

  title           text not null default 'Residential Lease',
  status          text not null default 'draft'
                    check (status in ('draft', 'sent', 'executed', 'void')),

  -- the assembled clause text at generation time (interpolated + joined).
  assembled_body  text,
  -- the SNAPSHOT: which clause versions were in force when this lease was
  -- assembled. Array of { clause_id, key, title, version_id, version, body }.
  -- Read by the renewal diff to show what changed since the tenant last signed.
  executed_clause_versions jsonb not null default '[]'::jsonb,

  executed_at     timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists lease_documents_org_idx
  on public.lease_documents(organization_id);
create index if not exists lease_documents_tenancy_idx
  on public.lease_documents(tenancy_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS — per-org, same shape as 0028 / 0033.
-- ---------------------------------------------------------------------------
alter table public.lease_clauses          enable row level security;
alter table public.lease_clause_versions  enable row level security;
alter table public.lease_documents        enable row level security;

drop policy if exists lease_clauses_all on public.lease_clauses;
create policy lease_clauses_all on public.lease_clauses
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists lease_clause_versions_all on public.lease_clause_versions;
create policy lease_clause_versions_all on public.lease_clause_versions
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists lease_documents_all on public.lease_documents;
create policy lease_documents_all on public.lease_documents
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard; service_role for a future signing callback / renewal cron.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.lease_clauses         to authenticated;
grant select, insert, update, delete on public.lease_clauses         to service_role;
grant select, insert, update, delete on public.lease_clause_versions to authenticated;
grant select, insert, update, delete on public.lease_clause_versions to service_role;
grant select, insert, update, delete on public.lease_documents       to authenticated;
grant select, insert, update, delete on public.lease_documents       to service_role;
