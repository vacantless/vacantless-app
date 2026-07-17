-- Link a showing-agent roster row to its login user, when the agent is also a
-- member. Nullable: external/magic-link agents stay unlinked. on delete set null
-- so deleting a user unlinks rather than removing the roster row.
alter table public.showing_agents
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- At most one agent row per (org, user): a login maps to a single roster identity.
create unique index if not exists showing_agents_org_user_uniq
  on public.showing_agents (organization_id, user_id)
  where user_id is not null;

-- Fast "my linked agent" lookup.
create index if not exists showing_agents_user_idx
  on public.showing_agents (user_id)
  where user_id is not null;
