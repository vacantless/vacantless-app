-- Per-user, per-org preferences overlay. Absence of a row == code defaults.
-- User-scoped RLS: a member sees/edits only their own row.
create table if not exists public.user_preferences (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  organization_id       uuid not null references public.organizations(id) on delete cascade,

  -- Default dashboard assigned-view for this member. null == no preference
  -- (fall back to the code default of "mine" for a linked member).
  default_assigned_view text check (default_assigned_view in ('mine','team')),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (user_id, organization_id)
);

create index if not exists user_preferences_user_org_idx
  on public.user_preferences (user_id, organization_id);

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_own on public.user_preferences;
create policy user_preferences_own on public.user_preferences
  for all
  using (user_id = auth.uid() and organization_id in (select public.user_org_ids()))
  with check (user_id = auth.uid() and organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.user_preferences to authenticated;
