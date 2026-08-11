-- 0212_relist_radar_email_decisions
-- Slice 2 for Relist Radar: dark email consent surface and one-click decision
-- storage. This records operator intent only. It does not charge, repost, edit,
-- or submit to any external portal.

alter table public.relist_radar_events
  add column if not exists decision text,
  add column if not exists decided_at timestamptz,
  add column if not exists decided_via text,
  add column if not exists notice_sent_at timestamptz,
  add column if not exists last_chance_sent_at timestamptz,
  add column if not exists lapse_nudge_sent_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'relist_radar_events_decision_check'
  ) then
    alter table public.relist_radar_events
      add constraint relist_radar_events_decision_check
      check (
        decision is null
        or decision in (
          'skipped',
          'paid_consented',
          'kept_live',
          'let_expire',
          'no_response'
        )
      );
  end if;
end $$;

comment on column public.relist_radar_events.decision is
  'Per expiry-cycle operator decision. Slice 2 records intent only: skipped, paid_consented, kept_live, let_expire, or system no_response.';
comment on column public.relist_radar_events.decided_via is
  'How the decision was recorded, for example relist_radar_email or relist_radar_paid_lapse.';
comment on column public.relist_radar_events.notice_sent_at is
  'When the first per-property Relist Radar email included this event.';
comment on column public.relist_radar_events.last_chance_sent_at is
  'When the expiry-eve last-chance email included this skipped free event.';
comment on column public.relist_radar_events.lapse_nudge_sent_at is
  'When the paid no-response post-expiry nudge included this event.';

create index if not exists idx_relist_radar_events_notice_due
  on public.relist_radar_events(organization_id, property_id, cycle_date)
  where event_type = 'radar_candidate'
    and notice_sent_at is null
    and decision is null;

create index if not exists idx_relist_radar_events_last_chance_due
  on public.relist_radar_events(organization_id, property_id, cycle_date)
  where event_type = 'radar_candidate'
    and paid = false
    and decision = 'skipped'
    and last_chance_sent_at is null;

create index if not exists idx_relist_radar_events_lapse_due
  on public.relist_radar_events(organization_id, property_id, cycle_date)
  where event_type = 'radar_candidate'
    and paid = true
    and decision is null
    and lapse_nudge_sent_at is null;

create table if not exists public.relist_radar_decision_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.relist_radar_events(id) on delete cascade,
  run_item_id uuid not null references public.distribution_run_items(id) on delete cascade,
  cycle_date date not null,
  channel text not null,
  action text not null
    check (action in ('skip', 'consent', 'keep_live', 'let_expire')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.relist_radar_decision_tokens is
  'Stores sha256 hashes for signed Relist Radar email action tokens. Raw tokens live only in emailed links and are single-use.';
comment on column public.relist_radar_decision_tokens.token_hash is
  'sha256 hex of the full signed token. The raw token is never stored.';
comment on column public.relist_radar_decision_tokens.used_at is
  'Set when the public decision route burns the token. Null means still unused until expires_at.';

create index if not exists idx_relist_radar_decision_tokens_event
  on public.relist_radar_decision_tokens(event_id, action);
create index if not exists idx_relist_radar_decision_tokens_unused
  on public.relist_radar_decision_tokens(expires_at)
  where used_at is null;

alter table public.relist_radar_decision_tokens enable row level security;
drop policy if exists relist_radar_decision_tokens_all on public.relist_radar_decision_tokens;
create policy relist_radar_decision_tokens_all on public.relist_radar_decision_tokens
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.relist_radar_decision_tokens to authenticated;
grant select, insert, update, delete on public.relist_radar_decision_tokens to service_role;
