-- ============================================================================
-- Vacantless - S788b: unit progress links (PLAN-S788-UNIT-PROGRESS).
-- ============================================================================
-- Landlords chase their crew for a vacancy schedule (Agile emails Narayan for a
-- PDF). Instead each crew member (manager, leasing, contractor, cleaner,
-- photographer) gets their own no-login link (/crew/<token>) and taps each
-- unit's stage: under construction, being cleaned, ready for photos, photos
-- in, ready to post, waiting for deposit, deposit clearing, rented.
--   crew_members           one row per person; link_token is the credential
--                          (stable uuid, like showing_agents.agent_token, 0117).
--   unit_progress_events   one row per tap (or landlord change); the latest
--                          row is the unit's current stage. Who and when kept.
-- The public page reads and writes only through the service role on the
-- server, re-deriving the org from the token; RLS here is for landlords.
-- Additive: no crew member changes nothing.
-- ============================================================================

create table if not exists public.crew_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(btrim(name)) between 1 and 120),
  role             text not null check (role in ('manager', 'leasing', 'contractor', 'cleaner', 'photographer')),
  contact          text,
  link_token       uuid not null default gen_random_uuid(),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists crew_members_link_token_key on public.crew_members (link_token);
create index if not exists crew_members_org_idx on public.crew_members (organization_id);

create table if not exists public.unit_progress_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  property_id      uuid not null references public.properties(id) on delete cascade,
  stage            text not null check (stage in (
                     'under_construction', 'being_cleaned', 'ready_for_photos',
                     'photographer_booked', 'photos_in', 'touch_up', 'ready_to_post',
                     'live', 'waiting_deposit', 'deposit_clearing', 'rented', 'put_back_up')),
  crew_member_id   uuid references public.crew_members(id) on delete set null,
  actor_user_id    uuid,
  note             text check (note is null or length(note) <= 500),
  created_at       timestamptz not null default now()
);

create index if not exists unit_progress_events_property_idx
  on public.unit_progress_events (property_id, created_at desc);
create index if not exists unit_progress_events_org_idx
  on public.unit_progress_events (organization_id, created_at desc);

alter table public.crew_members enable row level security;
alter table public.unit_progress_events enable row level security;

drop policy if exists crew_members_own on public.crew_members;
create policy crew_members_own on public.crew_members
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists unit_progress_events_select_own on public.unit_progress_events;
create policy unit_progress_events_select_own on public.unit_progress_events
  for select to authenticated
  using (organization_id in (select public.user_org_ids()));

drop policy if exists unit_progress_events_insert_own on public.unit_progress_events;
create policy unit_progress_events_insert_own on public.unit_progress_events
  for insert to authenticated
  with check (
    organization_id in (select public.user_org_ids())
    and exists (
      select 1 from public.properties p
      where p.id = unit_progress_events.property_id
        and p.organization_id = unit_progress_events.organization_id
    )
  );

grant select, insert, update, delete on public.crew_members to authenticated;
grant select, insert on public.unit_progress_events to authenticated;
grant select, insert, update, delete on public.crew_members to service_role;
grant select, insert, update, delete on public.unit_progress_events to service_role;
