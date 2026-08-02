-- ============================================================================
-- 0205_inspection_checklist_and_utility_tasks - move-in/out checklist + utility
-- transfer tracking (S614)
--
-- Adds structured, text-only checklist rows under tenancy_inspections and a
-- per-tenancy utility transfer tracker. This is additive to the existing
-- tenancy_inspections.condition_notes freeform field; it does not remove,
-- rename, or stop writing condition_notes.
--
-- SCOPE: v1 stores landlord-authored condition facts and utility handoff tasks
-- only. It does NOT attach photos/media, generate a formal condition-report
-- form, capture signatures, or alter listing utility-included booleans.
--
-- PII posture: stores the landlord's own condition notes and transfer status.
-- No driver's licence / SIN / credit / NOA data belongs here.
--
-- Conventions mirror tenancy_inspections (0094): organization_id is
-- denormalized onto each row so RLS gates on organization_id IN user_org_ids()
-- with no join; explicit grants keep new tables usable from the dashboard and
-- service-role maintenance paths.
-- ============================================================================

create table if not exists public.inspection_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id   uuid not null references public.tenancy_inspections(id) on delete cascade,

  -- Room or area label, e.g. Kitchen, Bathroom, General.
  area            text,

  -- Structured line item, e.g. Countertops or Smoke/CO detectors.
  item            text not null,

  -- Blank until rated. "na" covers items that do not apply to the unit.
  condition       text check (condition in ('good', 'fair', 'poor', 'damaged', 'na')),

  -- Text-only v1 per-item note. Photos/media are deferred to a later slice.
  note            text,

  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists inspection_checklist_items_org_idx
  on public.inspection_checklist_items(organization_id);
create index if not exists inspection_checklist_items_inspection_idx
  on public.inspection_checklist_items(inspection_id);

comment on table public.inspection_checklist_items is
  'Text-only structured checklist rows under tenancy_inspections for move-in/move-out condition capture. Additive to condition_notes; no media/signatures/form generation; landlord-authored condition facts only, no DL/SIN/credit PII.';
comment on column public.inspection_checklist_items.area is
  'Room or area label for grouping checklist items, such as Kitchen, Bathroom, or General.';
comment on column public.inspection_checklist_items.condition is
  'Optional condition rating: good, fair, poor, damaged, or na. Null means not rated yet.';
comment on column public.inspection_checklist_items.note is
  'Optional text-only per-item condition note. Media/photo capture is deferred to a later slice.';

alter table public.inspection_checklist_items enable row level security;

drop policy if exists inspection_checklist_items_all on public.inspection_checklist_items;
create policy inspection_checklist_items_all on public.inspection_checklist_items
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.inspection_checklist_items to authenticated;
grant select, insert, update, delete on public.inspection_checklist_items to service_role;

create table if not exists public.tenancy_utility_tasks (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  tenancy_id        uuid not null references public.tenancies(id) on delete cascade,

  -- Operator-editable transfer task, e.g. Hydro transfer or Internet.
  label             text not null,

  responsible_party text not null default 'tenant'
                       check (responsible_party in ('tenant', 'landlord', 'na')),
  target_date       date,
  status            text not null default 'todo'
                       check (status in ('todo', 'in_progress', 'done', 'na')),
  confirmation_note text,

  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists tenancy_utility_tasks_org_idx
  on public.tenancy_utility_tasks(organization_id);
create index if not exists tenancy_utility_tasks_tenancy_idx
  on public.tenancy_utility_tasks(tenancy_id);

comment on table public.tenancy_utility_tasks is
  'Per-tenancy utility-transfer tracker for move-in operational tasks such as hydro, gas, water, internet, tenant insurance proof, and mail forwarding. Separate from listing utility-included booleans; stores landlord-authored transfer status only.';
comment on column public.tenancy_utility_tasks.responsible_party is
  'Who owns the transfer task: tenant, landlord, or na.';
comment on column public.tenancy_utility_tasks.target_date is
  'Optional target date for completing the utility transfer or setup task.';
comment on column public.tenancy_utility_tasks.status is
  'Transfer task state: todo, in_progress, done, or na.';
comment on column public.tenancy_utility_tasks.confirmation_note is
  'Optional text-only confirmation note, such as account number received or proof requested.';

alter table public.tenancy_utility_tasks enable row level security;

drop policy if exists tenancy_utility_tasks_all on public.tenancy_utility_tasks;
create policy tenancy_utility_tasks_all on public.tenancy_utility_tasks
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.tenancy_utility_tasks to authenticated;
grant select, insert, update, delete on public.tenancy_utility_tasks to service_role;
