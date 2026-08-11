-- 0211_relist_radar_clock
-- Slice 1 substrate for Relist Radar: own the external ad expiry clock from
-- Vacantless proof data. Additive, nullable, and dark until the app flag is on.

alter table public.distribution_run_items
  add column if not exists external_posted_at timestamptz,
  add column if not exists external_expires_at timestamptz;

comment on column public.distribution_run_items.external_posted_at is
  'When Vacantless recorded this external portal ad as posted/live. Null for legacy rows or unknown proof.';
comment on column public.distribution_run_items.external_expires_at is
  'Computed portal expiry from external_posted_at plus channel TTL. Null when the channel TTL is unknown.';

create index if not exists idx_distribution_run_items_external_expires
  on public.distribution_run_items(organization_id, external_expires_at)
  where external_expires_at is not null;

create table if not exists public.relist_radar_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  settings jsonb not null default '{
    "notify_lead_days": 3,
    "refresh_now_semantics": "confirm_run_on_scheduled_day",
    "free_skip_behavior": "last_chance_then_lapse",
    "paid_lapse_followup": "nudge",
    "execution_time": "expiry_day_morning",
    "email_grouping": "combined_per_property",
    "autopilot_receipt": "monthly"
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relist_radar_settings_object
    check (jsonb_typeof(settings) = 'object')
);

comment on table public.relist_radar_settings is
  'Per-organization Relist Radar settings. Absence of a row means code applies the same default settings shape.';
comment on column public.relist_radar_settings.settings is
  'Relist Radar tunables: notify_lead_days, refresh_now_semantics, free_skip_behavior, paid_lapse_followup, execution_time, email_grouping, and autopilot_receipt.';

alter table public.relist_radar_settings enable row level security;
drop policy if exists relist_radar_settings_all on public.relist_radar_settings;
create policy relist_radar_settings_all on public.relist_radar_settings
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.relist_radar_settings to authenticated;
grant select, insert, update, delete on public.relist_radar_settings to service_role;

create table if not exists public.relist_radar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  run_id uuid references public.distribution_runs(id) on delete set null,
  run_item_id uuid not null references public.distribution_run_items(id) on delete cascade,
  listing_post_id uuid references public.listing_posts(id) on delete set null,
  channel text not null,
  event_type text not null default 'radar_candidate'
    check (event_type in ('radar_candidate')),
  cycle_date date not null,
  external_expires_at timestamptz not null,
  paid boolean not null default false,
  detected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_item_id, event_type, cycle_date)
);

comment on table public.relist_radar_events is
  'Dark Relist Radar event log. Slice 1 records near-expiry radar_candidate rows only; no email or execution.';
comment on column public.relist_radar_events.cycle_date is
  'Expiry-cycle date, normally the YYYY-MM-DD of external_expires_at, used for idempotency.';

create index if not exists idx_relist_radar_events_org_detected
  on public.relist_radar_events(organization_id, detected_at desc);
create index if not exists idx_relist_radar_events_run_item
  on public.relist_radar_events(run_item_id);

alter table public.relist_radar_events enable row level security;
drop policy if exists relist_radar_events_all on public.relist_radar_events;
create policy relist_radar_events_all on public.relist_radar_events
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.relist_radar_events to authenticated;
grant select, insert, update, delete on public.relist_radar_events to service_role;
