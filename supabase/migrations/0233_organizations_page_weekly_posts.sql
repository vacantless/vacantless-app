-- S702i: weekly automatic posts to the landlord's connected Facebook Page.
-- Opt-in per org. Off by default; the landlord turns it on from the rental's
-- Get online tab after connecting a Page.
alter table public.organizations
  add column if not exists page_weekly_posts boolean not null default false,
  add column if not exists page_weekly_posts_at timestamptz,
  add column if not exists page_weekly_posts_by uuid;
