-- S828c: a landlord who books each viewing themselves (no open calendar).
-- When on, Vacantless stops asking them to set viewing times, and renters see
-- "Request a viewing" with a few taps for when they can come.
alter table public.organizations
  add column if not exists viewings_by_request boolean not null default false;

comment on column public.organizations.viewings_by_request is
  'S828c: the landlord books each viewing themselves; no "set viewing times" prompts.';
