-- 0010_m4_stripe_billing.sql
-- M4 (owner layer + billing): track the Stripe subscription state on the org row.
--
-- `plan` (text, default 'trial') and `stripe_customer_id` (text) already exist
-- from the original schema. These three columns add the subscription identity
-- and lifecycle state that the Stripe webhook keeps in sync:
--   plan                  -> 'trial' | 'core' | 'plus'  (the tier, derived from the price)
--   subscription_status   -> Stripe sub status (active, trialing, past_due, canceled, ...)
--   stripe_subscription_id-> sub_... of the active subscription (null when none)
--   current_period_end    -> renewal/expiry of the current paid period
--
-- No new grant is needed: migration 0007 already granted service_role
-- select,update on public.organizations (table-level grant covers new columns),
-- which is how the webhook (service-role admin client) writes these. The owner
-- reads them through the normal RLS-scoped client (own-org SELECT), so no RPC.

alter table public.organizations
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists current_period_end timestamptz;

comment on column public.organizations.stripe_subscription_id is
  'Active Stripe subscription id (sub_...); null when the org has no subscription.';
comment on column public.organizations.subscription_status is
  'Latest Stripe subscription status: trialing|active|past_due|canceled|incomplete|incomplete_expired|unpaid|paused.';
comment on column public.organizations.current_period_end is
  'End of the current paid period (renewal/expiry); mirrored from the Stripe subscription.';
