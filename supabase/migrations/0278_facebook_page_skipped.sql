-- S770 (REVIEW-S770 section 3 item 3): a landlord with no Facebook Page sat at
-- "4 of 5 connected" with a "Needs you" row forever. "I don't have a Page" on
-- the Connect your rental sites page stamps this; the row leaves the list and
-- the count reads All set. Connecting a Page later clears it (lib/sites-setup
-- treats a linked Page as not skipped whatever the stamp says).

alter table public.organizations
  add column if not exists facebook_page_skipped_at timestamptz;

comment on column public.organizations.facebook_page_skipped_at is
  'The landlord said they have no Facebook Page (S770). The Facebook Page row leaves the sites list and the connected count. Null = not skipped. A linked Page wins over this stamp.';
