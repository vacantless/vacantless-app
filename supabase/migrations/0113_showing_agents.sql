-- ============================================================================
-- 0113_showing_agents — multi-operator showing routing, Slice 1 (S436).
--
-- WHY (dogfood, DOGFOOD-MULTI-OPERATOR-ROUTING-2026-07-07.md): Noam's own day
-- exposed that Vacantless has a SINGLE showing agent baked in. In one window he
-- had 3 showings + 2 offers + a house showing and had to delegate to a "#2 and a
-- #3" (Peter, Odette) by hand. The product needs FIRST-CLASS showing agents you
-- can ASSIGN a viewing to, routed on tier / location / product / capacity.
--
-- This slice adds the foundation: a per-org roster of account-less showing agents
-- (showing_agents) and an assignment pointer on showings (assigned_agent_id). It
-- deliberately mirrors the ACCOUNT-LESS-PARTY rolodex shape of trade_contacts
-- (0054): a showing agent is NOT a Supabase-Auth member — the real ones (Odette,
-- Peter) coordinate on their OWN calendars and CC the lead agent; they don't want
-- another login. A future slice can add a tokenized /agent/[token] view + shared
-- calendar (the get_dispatch_context pattern from 0065) without touching this
-- schema. The routing attributes (tier / service_area / product_types /
-- weekly_capacity) are stored now but UNWIRED in Slice 1 — Slice 2's pure
-- suggestOperator() scorer reads them.
--
-- NAMING: table is `showing_agents` (not `operators`) on purpose, to avoid
-- collision with the memberships.role='operator' AUTH concept (lib/roles.ts).
-- These are people you dispatch a viewing to; an "operator" is a logged-in member.
--
-- Conventions mirror 0054 / 0065: CHECK not a pg enum; per-org RLS via
-- organization_id in (select public.user_org_ids()); explicit grants because
-- auto-expose is OFF; service_role gets DML for any future cron. No new anon /
-- SECURITY DEFINER surface in this slice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- showing_agents — the org's roster of showing agents ("#1 / #2 / #3").
--   Account-less, exactly like trade_contacts (0054): a name + how to reach them
--   + optional routing attributes. Archived, never hard-deleted, so a showing's
--   assignment history survives (assigned_agent_id is on-delete-set-null anyway).
-- ---------------------------------------------------------------------------
create table if not exists public.showing_agents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  name            text not null,
  email           text,
  phone           text,

  -- ---- routing attributes (stored now; Slice 2 suggestOperator reads them) ---
  -- tier: free text so Noam can settle terminology later (lead / associate /
  --   helper / runner). Higher-tier product routes to a higher-tier agent (Peter
  --   got the ~$6-7k/mo York Mills house).
  tier            text,
  -- service_area: free-text geography the agent covers (e.g. 'York Mills').
  service_area    text,
  -- product_types: which product this agent handles — 'rental','sale','condo',
  --   'house','apartment'. Free-text array; the UI offers a suggested set. Empty
  --   == no product filter (eligible for anything).
  product_types   text[] not null default '{}',
  -- weekly_capacity: max viewings/week this agent can take. NULL == uncapped.
  --   Peter is capacity-limited (a busier schedule) — routing must respect this.
  weekly_capacity integer,

  note            text,
  archived        boolean not null default false,

  created_at      timestamptz not null default now(),

  constraint showing_agents_weekly_capacity_chk
    check (weekly_capacity is null or weekly_capacity >= 0)
);

create index if not exists showing_agents_org_idx
  on public.showing_agents(organization_id);

alter table public.showing_agents enable row level security;

drop policy if exists showing_agents_all on public.showing_agents;
create policy showing_agents_all on public.showing_agents
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.showing_agents to authenticated;
grant select, insert, update, delete on public.showing_agents to service_role;

-- ---------------------------------------------------------------------------
-- showings.assigned_agent_id — who's running this viewing.
--   set-null on a deleted/archived agent so the showing survives (the record
--   just goes back to "unassigned"). assigned_at stamps when it was routed, for
--   the future oversight view. Nullable: an unassigned viewing (the current
--   single-agent behavior) is still perfectly valid, so this ships live-safe —
--   an org that never assigns sees no change.
-- ---------------------------------------------------------------------------
alter table public.showings
  add column if not exists assigned_agent_id uuid
    references public.showing_agents(id) on delete set null,
  add column if not exists assigned_at timestamptz;

create index if not exists showings_assigned_agent_idx
  on public.showings(organization_id, assigned_agent_id);
