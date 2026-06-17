-- ============================================================================
-- 0037_tenancy_stripe_subscription — link a tenancy to its Stripe rent
-- subscription (platform pivot step 2, ALT provider, increment 3: monthly rent; S215)
--
-- Sibling of 0031 (rotessa_schedule_id). Increment 2 (0036) saved a bank-debit
-- MANDATE + payment method on the connected account. This increment creates a
-- monthly Stripe SUBSCRIPTION (Billing API; Checkout subscription mode doesn't
-- support ACSS) that bills that saved payment method at the tenancy rent. We
-- store only Stripe's subscription id + its status + when we last synced.
--
--   * stripe_subscription_id        — sub_... on the connected account. NULL until created.
--   * stripe_subscription_status    — last-known Stripe status (active/past_due/
--                                     incomplete/canceled/...). Free text (Stripe
--                                     owns the vocabulary); the UI maps it to a label.
--   * stripe_subscription_synced_at — when we last created/refreshed it.
--
-- Additive + nullable: no backfill, safe to apply ahead of the code deploy.
-- ============================================================================

alter table public.tenancies
  add column if not exists stripe_subscription_id        text,
  add column if not exists stripe_subscription_status    text,
  add column if not exists stripe_subscription_synced_at timestamptz;
