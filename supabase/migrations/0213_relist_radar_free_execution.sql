-- 0213_relist_radar_free_execution
-- Slice 3 substrate for Relist Radar free refresh execution.
--
-- The app enqueues an already-live Kijiji item for the worker only after it has
-- snapshotted the listing facts and photo references. The worker still posts
-- only through the free-plan path, and the channel is not marked Live until the
-- existing proof flow confirms a real external URL.

alter table public.distribution_run_items
  add column if not exists relist_radar_backup jsonb;

comment on column public.distribution_run_items.relist_radar_backup is
  'Backup of listing facts, photo references, and prior external-ad pointers captured before a Relist Radar free refresh is enqueued.';
