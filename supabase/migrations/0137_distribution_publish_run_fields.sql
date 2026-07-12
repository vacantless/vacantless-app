-- ============================================================================
-- 0137_distribution_publish_run_fields — one-click publish run state
--
-- S467 asks the Distribute tab to create one durable publishing run across
-- selected channels, while keeping channel truth honest:
--   * "Live" only when the public page or a tracked external URL is actually live.
--   * feed/API/partner channels can be submitted without claiming external live.
--   * Facebook/Kijiji stay browser co-pilot or concierge, not fake automation.
--
-- Reuse distribution_runs / distribution_run_items and add non-breaking fields
-- for publish-mode state. The existing `status` column remains the legacy
-- checklist progress field so older code and rows keep working.
-- ============================================================================

alter table public.distribution_run_items
  drop constraint if exists distribution_run_items_channel_check;

alter table public.distribution_run_items
  add constraint distribution_run_items_channel_check
  check (channel in (
    'vacantless',
    'org_feed',
    'network_feed',
    'kijiji',
    'facebook',
    'rentals_ca',
    'zumper',
    'viewit',
    'realtor_ca',
    'other'
  ));

alter table public.distribution_run_items
  add column if not exists publish_status text,
  add column if not exists mode text,
  add column if not exists blockers jsonb not null default '[]'::jsonb,
  add column if not exists last_attempted_at timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists operator_action_url text,
  add column if not exists audit_message text;

alter table public.distribution_run_items
  drop constraint if exists distribution_run_items_publish_status_check;
alter table public.distribution_run_items
  add constraint distribution_run_items_publish_status_check
  check (
    publish_status is null or publish_status in (
      'blocked',
      'queued',
      'submitting',
      'submitted',
      'needs_operator',
      'needs_login',
      'needs_payment',
      'live',
      'rejected',
      'skipped'
    )
  );

alter table public.distribution_run_items
  drop constraint if exists distribution_run_items_mode_check;
alter table public.distribution_run_items
  add constraint distribution_run_items_mode_check
  check (
    mode is null or mode in (
      'automatic',
      'feed_partner',
      'browser_copilot',
      'concierge',
      'broker',
      'custom'
    )
  );

alter table public.distribution_run_items
  drop constraint if exists distribution_run_items_blockers_array_check;
alter table public.distribution_run_items
  add constraint distribution_run_items_blockers_array_check
  check (jsonb_typeof(blockers) = 'array');
