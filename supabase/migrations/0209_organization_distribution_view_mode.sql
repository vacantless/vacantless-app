alter table public.organizations
  add column if not exists distribution_view_mode text
  check (distribution_view_mode in ('simple', 'advanced'));
