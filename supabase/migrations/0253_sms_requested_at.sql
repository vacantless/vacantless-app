-- 0253_sms_requested_at.sql (S726f)
-- When a Growth landlord pressed "Turn on texting" in Settings. Staff then buy
-- a local Twilio number and add the org_sms_numbers row (SKILL N+113). Null =
-- never asked. Additive and nullable; nothing reads it for sending.
alter table public.organizations
  add column if not exists sms_requested_at timestamptz;
