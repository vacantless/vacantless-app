-- ============================================================================
-- 0105_distribution_runs — guided launch runs (S412 Slice 2)
--
-- The Distribute command center (S412 Slice 1) shows per-channel status from
-- listing_posts. This adds the OPERATIONAL layer the syndication plan asks for:
-- a saved, resumable "launch run" so posting a rental to several channels is a
-- tracked checklist, not a scattered set of copy/paste actions.
--
--   * distribution_runs      — one run per (property) posting session. status
--     active until every item is done/skipped, then completed. Cancellable.
--   * distribution_run_items — one row per channel selected for the run. Carries
--     the operator's progress (pending -> in_progress -> done|skipped), the live
--     ad URL they pasted at the end, an optional link to the listing_posts row
--     the run produced (so the run feeds source attribution + the tracker), and
--     free notes.
--
-- The step-by-step checklist ITSELF is derived in code (lib/distribution-run
-- from the channel matrix + fill sheet + guardrails) — this table stores only
-- the durable progress, not the static steps. One item per (run, channel).
--
-- Conventions mirror listing_posts (0014) + work_order_appointments (0095):
--   * organization_id DENORMALIZED on both tables so RLS gates on user_org_ids()
--     with no join. Cascade with the org.
--   * run_items cascade with their run; listing_post_id is set-null (removing a
--     tracked post never destroys the run history).
--   * explicit grants (auto-expose of new tables is OFF). No public/anon access
--     and no cron, so no SECURITY DEFINER RPC and no service_role grant needed.
--   * additive + inert: ships with zero rows until an operator starts a run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- distribution_runs — one posting session for a property.
-- ---------------------------------------------------------------------------
create table if not exists public.distribution_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  property_id      uuid not null references public.properties(id) on delete cascade,
  status           text not null default 'active'
                     check (status in ('active', 'completed', 'cancelled')),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index if not exists idx_distribution_runs_property
  on public.distribution_runs(property_id);
create index if not exists idx_distribution_runs_org
  on public.distribution_runs(organization_id);

-- ---------------------------------------------------------------------------
-- distribution_run_items — one channel's progress within a run.
-- ---------------------------------------------------------------------------
create table if not exists public.distribution_run_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  run_id           uuid not null references public.distribution_runs(id) on delete cascade,
  channel          text not null
                     check (channel in (
                       'kijiji', 'facebook', 'rentals_ca', 'zumper',
                       'viewit', 'realtor_ca', 'other'
                     )),
  status           text not null default 'pending'
                     check (status in ('pending', 'in_progress', 'done', 'skipped')),
  external_url     text,
  listing_post_id  uuid references public.listing_posts(id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (run_id, channel)
);

create index if not exists idx_distribution_run_items_run
  on public.distribution_run_items(run_id);
create index if not exists idx_distribution_run_items_org
  on public.distribution_run_items(organization_id);

-- ---------------------------------------------------------------------------
-- RLS + grants — same per-org shape as every other tenant table.
-- ---------------------------------------------------------------------------
alter table public.distribution_runs enable row level security;
drop policy if exists distribution_runs_all on public.distribution_runs;
create policy distribution_runs_all on public.distribution_runs
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));
grant select, insert, update, delete on public.distribution_runs to authenticated;

alter table public.distribution_run_items enable row level security;
drop policy if exists distribution_run_items_all on public.distribution_run_items;
create policy distribution_run_items_all on public.distribution_run_items
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));
grant select, insert, update, delete on public.distribution_run_items to authenticated;
