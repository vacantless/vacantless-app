-- S736: texting numbers are bought, set up and released by the app.
--
-- Before: a Growth landlord pressed "Turn on texting", the admins got an email,
-- and staff bought a Twilio number by hand (SKILL N+113). Now the press buys a
-- local number through Twilio's API and switches it on; the 15-minute sweep
-- (/api/cron/texting-numbers) retries a failed purchase and releases a number
-- the app bought once its account has left Growth (or closed) for 7 days, so
-- nobody pays for a number nobody uses.
--
-- twilio_sid marks a number the app bought and may release. A row without it
-- (Agile's 226 number, set by hand) is never released by the app.

alter table public.org_sms_numbers
  add column if not exists twilio_sid text,
  add column if not exists lapsed_since timestamptz;

alter table public.organizations
  add column if not exists sms_provision_attempts integer not null default 0,
  add column if not exists sms_provision_tried_at timestamptz,
  add column if not exists sms_provision_error text;

comment on column public.org_sms_numbers.twilio_sid is
  'S736: Twilio IncomingPhoneNumber sid when the app bought the number; the app releases only these.';
comment on column public.org_sms_numbers.lapsed_since is
  'S736: first time the sweep saw the account without texting on its plan (or closed); released 7 days later.';
comment on column public.organizations.sms_provision_attempts is
  'S736: failed automatic number purchases since the last request; admins are emailed once at 5.';
