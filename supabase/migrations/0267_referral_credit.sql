-- 0267 (S746b): the referral credit. When a referred landlord pays their first
-- Growth invoice, the referrer and the referred account each receive a CA$99
-- Stripe customer-balance credit (one month of Growth). These two columns make
-- the grant idempotent: the webhook grants only where referral_credit_at is null.
-- Written by the service role from the Stripe webhook only; the existing RLS on
-- org_invites (select own referrals) is unchanged and no landlord policy writes
-- these columns.
alter table public.org_invites
  add column if not exists referral_credit_at timestamptz,
  add column if not exists referral_credit_cents integer;

comment on column public.org_invites.referral_credit_at is
  'S746b: when the referral credit was granted to both sides (null = not yet).';
comment on column public.org_invites.referral_credit_cents is
  'S746b: the credit each side received, in cents (CA$99 = 9900).';
