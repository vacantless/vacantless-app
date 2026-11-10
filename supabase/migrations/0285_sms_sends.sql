-- ============================================================================
-- Vacantless - S777: one row per text sent from a landlord's own number.
-- ============================================================================
-- The monthly text limit (lib/sms-limit.ts, 500 a month) counted outbound sms
-- rows in messages, but only renter conversations write there. Landlord alerts
-- (tenant emergencies, site sign-outs) and the tenant notice, waitlist, repair
-- appointment and booking texts did not, so the limit undercounted (KI1549).
--   sms_sends  written by sendSms after Twilio accepts a text from the org's
--              own number. Service role only (RLS on, no policies): the app
--              reads it through the admin client to count the month.
-- Additive: until it fills, the count is the larger of messages and sms_sends.
-- ============================================================================

create table if not exists public.sms_sends (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  sent_at          timestamptz not null default now()
);

create index if not exists sms_sends_org_sent_idx on public.sms_sends (organization_id, sent_at);

alter table public.sms_sends enable row level security;
