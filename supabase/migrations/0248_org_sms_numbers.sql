-- ============================================================================
-- 0248_org_sms_numbers (S717)
--
-- Each landlord's own texting number. Renter texts for an account with an
-- enabled row here go out from that number (Twilio), and texts or STOPs that
-- come in to that number are filed to that account only. Accounts without a
-- row keep today's behaviour (the shared QUO number, staff switch only).
--
-- Staff-only, like platform_org_switches (0247): RLS on, no policies, granted
-- to service_role only. Landlords cannot read or write it.
--
-- One number per account, and a number belongs to one account. Only Canadian
-- style +1 numbers are accepted. Rows start disabled: staff turn a number on
-- after it is bought and its incoming-text webhook is set.
-- Idempotent. Applying it changes nothing until a row is added.
-- ============================================================================

create table if not exists public.org_sms_numbers (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  phone_e164      text not null,
  provider        text not null default 'twilio',
  enabled         boolean not null default false,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

do $$
begin
  alter table public.org_sms_numbers drop constraint if exists org_sms_numbers_phone_check;
  alter table public.org_sms_numbers
    add constraint org_sms_numbers_phone_check check (phone_e164 ~ '^\+1[2-9][0-9]{9}$');
  alter table public.org_sms_numbers drop constraint if exists org_sms_numbers_provider_check;
  alter table public.org_sms_numbers
    add constraint org_sms_numbers_provider_check check (provider in ('twilio'));
end $$;

create unique index if not exists org_sms_numbers_phone_unique
  on public.org_sms_numbers (phone_e164);

alter table public.org_sms_numbers enable row level security;

revoke all on public.org_sms_numbers from anon, authenticated;
grant select, insert, update, delete on public.org_sms_numbers to service_role;

comment on table public.org_sms_numbers is
  'Staff-only per-account texting number (S717). Service role only. Read by lib/org-sms-numbers.ts.';
