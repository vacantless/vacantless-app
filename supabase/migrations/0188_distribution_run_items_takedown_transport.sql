-- ============================================================================
-- 0188_distribution_run_items_takedown_transport
--
-- S575b: keep lease-up take-down tasks out of the done-for-you publish worker.
-- These rows still live in distribution_run_items, but transport='takedown'
-- marks them as delete/remove work, not new-post preparation work.
-- ============================================================================

alter table public.distribution_run_items
  drop constraint if exists distribution_run_items_transport_check;

alter table public.distribution_run_items
  add constraint distribution_run_items_transport_check
  check (
    transport is null or transport in (
      'automatic',
      'feed_partner',
      'browser_copilot',
      'concierge',
      'broker',
      'custom',
      'takedown'
    )
  );
