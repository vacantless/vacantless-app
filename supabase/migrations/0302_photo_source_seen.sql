-- S803: photos counted as already on the rental when its folder was linked
-- (lib/drive-import mergeSeenRefs). A later pull skips these, so linking the
-- folder of a rental that already has its photos never copies them twice.
alter table public.properties
  add column if not exists photo_source_seen text[] not null default '{}';
