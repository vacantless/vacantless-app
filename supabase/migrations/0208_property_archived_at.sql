alter table public.properties
  add column if not exists archived_at timestamptz;

create index if not exists properties_archived_at_idx
  on public.properties (organization_id)
  where archived_at is not null;
