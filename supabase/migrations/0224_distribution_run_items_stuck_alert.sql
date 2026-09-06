-- ============================================================================
-- 0224 (S681): remember when the stuck-item sweep last nagged about a run item.
--
-- WHY. leasing.distribution_job_needs_action only ever fired at the MOMENT the
-- distribution-worker cron moved an item to its gate. Nothing ever looked at an
-- item that was ALREADY parked. Items reached a human gate by other paths, or
-- before that code existed, and were never mentioned again: nine of them, the
-- oldest 54 days, including a real landlord org whose concierge request sat
-- `queued` for 48 days because the org had no distribution_channel_accounts row
-- and so could never become eligible.
--
-- This column lets a sweep nag ONCE and then at most weekly, instead of either
-- never (today) or every single run (spam).
--
-- Additive and nullable. Null means never alerted, which is the correct reading
-- for every existing row.
-- ============================================================================

alter table public.distribution_run_items
  add column if not exists last_stuck_alerted_at timestamptz;

comment on column public.distribution_run_items.last_stuck_alerted_at is
  'S681: when the stuck-item sweep last sent leasing.distribution_job_needs_action for this item. Null = never alerted.';

-- The sweep filters on publish_status and orders by this column. Partial index
-- keeps it off the ~2k live/failed rows the sweep never looks at.
create index if not exists distribution_run_items_stuck_sweep_idx
  on public.distribution_run_items (publish_status, last_stuck_alerted_at)
  where publish_status in ('needs_login', 'needs_payment', 'needs_operator', 'queued');
