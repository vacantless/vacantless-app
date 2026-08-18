alter table public.properties
  add column if not exists status_before_archive text;

alter table public.properties
  drop constraint if exists properties_status_before_archive_chk;

alter table public.properties
  add constraint properties_status_before_archive_chk
  check (
    status_before_archive is null
    or status_before_archive = any (array['draft','available','paused','leased','off_market'])
  );

comment on column public.properties.status_before_archive is
  'Status captured at archive time so unarchive can restore it. Null when not archived or when archive did not change status. See 0216 / S662.';
