alter table public.leads
  add column if not exists reopen_notified_at timestamptz;

alter table public.organizations
  add column if not exists availability_reopened_at timestamptz;
