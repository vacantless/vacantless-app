-- S723: where a new account came from, and which ad conversions were sent.
-- signup_source: first-touch ad tags copied from the vl_src cookie at sign-up
--   (lib/signup-source.ts). Null for accounts made before S723 or with no source.
-- ad_conversions: {"signup": iso, "first_live": iso} once each conversion was
--   reported to Google/Meta, so each fires once (lib/ad-conversions.ts).
alter table public.organizations
  add column if not exists signup_source jsonb,
  add column if not exists ad_conversions jsonb not null default '{}'::jsonb;
