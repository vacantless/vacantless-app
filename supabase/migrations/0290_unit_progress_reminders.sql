-- ============================================================================
-- Vacantless - S788d: unit progress reminders and the landlord's copy.
-- ============================================================================
-- One row per reminder sent to a crew member about a unit (or the weekly
-- check-in). The sweep reads it so a reminder repeats on its own cadence and
-- never more than once a day per person; escalated_at marks the one copy the
-- landlord gets when a reminder sat 3 days with no update. Service role
-- writes; landlords can read their own.
-- ============================================================================

create table if not exists public.unit_progress_reminders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  crew_member_id   uuid not null references public.crew_members(id) on delete cascade,
  property_id      uuid references public.properties(id) on delete cascade,
  reason           text not null check (reason in (
                     'weekly_stale', 'past_ready_by', 'reno_no_date', 'deposit_waiting',
                     'deposit_clearing', 'moveout_soon', 'moveout_today')),
  sent_at          timestamptz not null default now(),
  escalated_at     timestamptz
);

create index if not exists unit_progress_reminders_crew_idx
  on public.unit_progress_reminders (crew_member_id, sent_at desc);
create index if not exists unit_progress_reminders_org_idx
  on public.unit_progress_reminders (organization_id, sent_at desc);

alter table public.unit_progress_reminders enable row level security;

drop policy if exists unit_progress_reminders_select_own on public.unit_progress_reminders;
create policy unit_progress_reminders_select_own on public.unit_progress_reminders
  for select to authenticated
  using (organization_id in (select public.user_org_ids()));

grant select on public.unit_progress_reminders to authenticated;
grant select, insert, update, delete on public.unit_progress_reminders to service_role;
