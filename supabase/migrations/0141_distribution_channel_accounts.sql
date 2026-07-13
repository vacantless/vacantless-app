-- ============================================================================
-- 0141_distribution_channel_accounts — first-class distribution substrate (S480)
--
-- The one-click publish run (0137/0139) models per-channel mode + honest status
-- and a concierge desk. S480 adds the OPERATIONAL substrate that makes it
-- Rentsync-grade: (1) a per-org/channel ACCOUNT + setup readiness record, richer
-- than the feed-only distribution_partner_accounts (0106, kept for back-compat);
-- (2) an append-only ATTEMPT log so run-item history survives, not just the
-- latest status; (3) durable VERIFICATION/proof records so a channel is only
-- ever "live" with proof, and feed-ready ("submitted") stays distinct from
-- externally live. Plus additive run-item pointers so the Publish UI can show
-- transport, setup status, verification status, proof, and next action.
--
-- POSTURE / invariants (design brief 2026-07-13):
--   * Additive + non-breaking. Existing publish-run behaviour is untouched.
--   * Org-scoped RLS on user_org_ids() + explicit grants (auto-expose off),
--     mirroring 0105/0106/0137. Proof/attempt/account rows can never cross orgs.
--   * listing_posts stays the CANONICAL lead-attribution source; these tables
--     augment it (they do not create a second attribution truth).
--   * No external portal credentials are stored here. No CAPTCHA/login/payment
--     bypass. Facebook/Kijiji remain copilot/concierge transports.
--   * Reversible (drop the three tables + the added columns).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- distribution_channel_accounts — one org/channel setup + capability record.
-- ---------------------------------------------------------------------------
create table if not exists public.distribution_channel_accounts (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations(id) on delete cascade,
  channel                     text not null
                                check (channel in (
                                  'vacantless', 'org_feed', 'network_feed',
                                  'facebook', 'kijiji', 'rentals_ca', 'zumper',
                                  'viewit', 'realtor_ca', 'other'
                                )),
  transport                   text not null
                                check (transport in (
                                  'automatic', 'feed_partner', 'browser_copilot',
                                  'concierge', 'broker', 'custom'
                                )),
  account_status              text not null default 'not_started'
                                check (account_status in (
                                  'not_started', 'needs_setup', 'submitted',
                                  'accepted', 'paused', 'rejected', 'connected',
                                  'needs_login', 'needs_payment'
                                )),
  feed_url                    text,
  manager_url                 text,
  external_account_label      text,
  contact_name                text,
  contact_email               text,
  requires_login              boolean not null default false,
  requires_payment            boolean not null default false,
  supports_feed               boolean not null default false,
  supports_copilot            boolean not null default false,
  supports_concierge          boolean not null default false,
  supports_live_verification  boolean not null default true,
  posting_policy              text not null default 'human_confirmed'
                                check (posting_policy in (
                                  'automatic_allowed', 'feed_only',
                                  'human_confirmed', 'concierge_only',
                                  'broker_only', 'not_supported'
                                )),
  capabilities                jsonb not null default '{}'::jsonb,
  setup_blockers              jsonb not null default '[]'::jsonb
                                check (jsonb_typeof(setup_blockers) = 'array'),
  notes                       text,
  last_setup_checked_at       timestamptz,
  last_successful_publish_at  timestamptz,
  last_verification_at        timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (organization_id, channel)
);

create index if not exists idx_distribution_channel_accounts_org
  on public.distribution_channel_accounts(organization_id);

alter table public.distribution_channel_accounts enable row level security;
drop policy if exists distribution_channel_accounts_all on public.distribution_channel_accounts;
create policy distribution_channel_accounts_all on public.distribution_channel_accounts
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));
grant select, insert, update, delete
  on public.distribution_channel_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- distribution_verifications — durable proof + live/stale/rejected checks.
-- One row per verification event; the run item points at the latest one.
-- ---------------------------------------------------------------------------
create table if not exists public.distribution_verifications (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  property_id        uuid references public.properties(id) on delete cascade,
  run_id             uuid references public.distribution_runs(id) on delete set null,
  run_item_id        uuid references public.distribution_run_items(id) on delete set null,
  listing_post_id    uuid references public.listing_posts(id) on delete set null,
  channel            text not null,
  verification_type  text not null
                       check (verification_type in (
                         'public_page', 'feed_render', 'partner_submission',
                         'external_url', 'screenshot', 'manual_concierge',
                         'broker_confirmation'
                       )),
  result             text not null
                       check (result in (
                         'verified_live', 'verified_submitted', 'stale',
                         'not_found', 'blocked', 'needs_login', 'needs_payment',
                         'proof_unavailable', 'failed'
                       )),
  external_url       text,
  screenshot_path    text,
  html_excerpt       text,
  matched_fields     jsonb not null default '{}'::jsonb,
  failure_reason     text,
  checked_by         uuid references auth.users(id) on delete set null,
  checked_at         timestamptz not null default now(),
  next_check_at      timestamptz,
  metadata           jsonb not null default '{}'::jsonb
);

create index if not exists idx_distribution_verifications_org
  on public.distribution_verifications(organization_id);
create index if not exists idx_distribution_verifications_run_item
  on public.distribution_verifications(run_item_id);
create index if not exists idx_distribution_verifications_property
  on public.distribution_verifications(property_id);

alter table public.distribution_verifications enable row level security;
drop policy if exists distribution_verifications_all on public.distribution_verifications;
create policy distribution_verifications_all on public.distribution_verifications
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));
grant select, insert, update, delete
  on public.distribution_verifications to authenticated;

-- ---------------------------------------------------------------------------
-- distribution_publish_attempts — append-only attempt/audit log per run item.
-- ---------------------------------------------------------------------------
create table if not exists public.distribution_publish_attempts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  run_id           uuid not null references public.distribution_runs(id) on delete cascade,
  run_item_id      uuid not null references public.distribution_run_items(id) on delete cascade,
  channel          text not null,
  transport        text,
  attempt_no       integer not null default 1,
  actor_type       text not null default 'operator'
                     check (actor_type in (
                       'system', 'operator', 'concierge', 'browser_copilot', 'broker'
                     )),
  actor_user_id    uuid references auth.users(id) on delete set null,
  status_before    text,
  status_after     text not null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  error_code       text,
  error_message    text,
  proof_id         uuid references public.distribution_verifications(id) on delete set null,
  metadata         jsonb not null default '{}'::jsonb
);

create index if not exists idx_distribution_publish_attempts_run_item
  on public.distribution_publish_attempts(run_item_id);
create index if not exists idx_distribution_publish_attempts_org
  on public.distribution_publish_attempts(organization_id);

alter table public.distribution_publish_attempts enable row level security;
drop policy if exists distribution_publish_attempts_all on public.distribution_publish_attempts;
create policy distribution_publish_attempts_all on public.distribution_publish_attempts
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));
grant select, insert, update, delete
  on public.distribution_publish_attempts to authenticated;

-- ---------------------------------------------------------------------------
-- distribution_run_items — additive first-class pointers (non-breaking).
-- ---------------------------------------------------------------------------
alter table public.distribution_run_items
  add column if not exists account_id                uuid references public.distribution_channel_accounts(id) on delete set null,
  add column if not exists transport                 text,
  add column if not exists attempt_count             integer not null default 0,
  add column if not exists last_attempt_id           uuid references public.distribution_publish_attempts(id) on delete set null,
  add column if not exists last_verification_id       uuid references public.distribution_verifications(id) on delete set null,
  add column if not exists verification_status        text,
  add column if not exists proof_url                  text,
  add column if not exists proof_screenshot_path      text,
  add column if not exists next_retry_at              timestamptz,
  add column if not exists stale_after                timestamptz,
  add column if not exists requires_human_confirmation boolean not null default false;

alter table public.distribution_run_items
  drop constraint if exists distribution_run_items_transport_check;
alter table public.distribution_run_items
  add constraint distribution_run_items_transport_check
  check (
    transport is null or transport in (
      'automatic', 'feed_partner', 'browser_copilot', 'concierge', 'broker', 'custom'
    )
  );

alter table public.distribution_run_items
  drop constraint if exists distribution_run_items_verification_status_check;
alter table public.distribution_run_items
  add constraint distribution_run_items_verification_status_check
  check (
    verification_status is null or verification_status in (
      'unverified', 'verified_live', 'verified_submitted', 'stale',
      'not_found', 'blocked', 'needs_login', 'needs_payment',
      'proof_unavailable', 'failed'
    )
  );
