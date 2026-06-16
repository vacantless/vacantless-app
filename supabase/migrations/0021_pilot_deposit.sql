-- 0021_pilot_deposit.sql
-- Phase B: in-app Stripe deposit Checkout for the pilot's refundable $200 setup
-- deposit. Until now the deposit was collected OUT-OF-BAND (a manual secure
-- link during onboarding); this lets the operator pay it from the billing page
-- with a one-time Stripe Checkout (mode='payment'), and the Stripe webhook
-- records the result here.
--
-- The deposit is a one-time charge, not a subscription, so it lives in its own
-- columns rather than reusing the subscription fields:
--   pilot_deposit_status            -> 'none' (default) | 'paid' | 'refunded'
--   pilot_deposit_payment_intent_id -> pi_... of the deposit charge (refund key)
--   pilot_deposit_amount_cents      -> what was actually collected (history-safe;
--                                      independent of any later Price change)
--   pilot_deposit_paid_at           -> when the deposit cleared
--
-- No new GRANT: 0007 already granted service_role select,update on
-- public.organizations (the webhook writes these via the service-role admin
-- client), and the owner reads them through the normal RLS-scoped own-org
-- SELECT, so no RPC change. A CHECK keeps the status to the three known values.

alter table public.organizations
  add column if not exists pilot_deposit_status text not null default 'none',
  add column if not exists pilot_deposit_payment_intent_id text,
  add column if not exists pilot_deposit_amount_cents integer,
  add column if not exists pilot_deposit_paid_at timestamptz;

-- Constrain the status to the known set. Drop-then-add so re-running the
-- migration (or tightening the set later) is safe.
alter table public.organizations
  drop constraint if exists organizations_pilot_deposit_status_check;
alter table public.organizations
  add constraint organizations_pilot_deposit_status_check
  check (pilot_deposit_status in ('none', 'paid', 'refunded'));

comment on column public.organizations.pilot_deposit_status is
  'Pilot setup-deposit state: none|paid|refunded. Set by the Stripe webhook on the one-time deposit Checkout (and on a later refund).';
comment on column public.organizations.pilot_deposit_payment_intent_id is
  'Stripe PaymentIntent id (pi_...) for the deposit charge; used to match a later charge.refunded event back to this org.';
comment on column public.organizations.pilot_deposit_amount_cents is
  'Amount actually collected for the deposit (cents, CAD); recorded from the Checkout session so history is independent of any later Price change.';
comment on column public.organizations.pilot_deposit_paid_at is
  'When the deposit payment cleared (from checkout.session.completed).';
