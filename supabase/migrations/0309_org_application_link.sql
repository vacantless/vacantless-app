-- 0309 (S818b): an account can use its own rental application form (Buildium,
-- Rentec, Yardi...) instead of the Vacantless one. "Send application" then
-- emails that link. Noam 2026-11-18 ("how can this integrate with buildium
-- better with their rental application?", then "Proceed"). Additive; the
-- existing organizations grants cover the new columns.
alter table public.organizations
  add column if not exists application_link_url  text,
  add column if not exists application_link_name text;
