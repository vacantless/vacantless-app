-- ============================================================================
-- 0133_stripe_rent_amount_sync — renewal & rent-increase autopilot Slice C (S460).
--
-- Bookkeeping for pushing a recorded rent increase onto the tenancy's Stripe
-- rent subscription (spec: SPEC-STRIPE-RENT-RATE-CHANGE, S420). updateStripeRentAmount
-- applies the new amount via a Stripe Subscription Schedule that starts EXACTLY
-- on the legal effective date (N1-served + 90), never billing early. These
-- columns are the once-synced idempotency guard + the schedule handle:
--   * stripe_rent_amount_synced_cents — the amount last pushed to Stripe (guards
--     a re-run to a no-op; distinct from rent_cents, the rent of record).
--   * stripe_rent_amount_synced_at    — when we last pushed.
--   * stripe_subscription_schedule_id — the schedule created from the sub, so a
--     later edit REPLACES phase 2 instead of stacking a second schedule.
--
-- All additive + nullable; ships inert (no Stripe call until the operator taps
-- "update the Stripe charge"). Reversible (drop the columns).
-- ============================================================================

alter table public.tenancies
  add column if not exists stripe_rent_amount_synced_cents integer,
  add column if not exists stripe_rent_amount_synced_at timestamptz,
  add column if not exists stripe_subscription_schedule_id text;

comment on column public.tenancies.stripe_rent_amount_synced_cents is
  'The rent amount (cents) last pushed to the Stripe subscription via updateStripeRentAmount; the idempotency guard against a duplicate rate change (S460/S420).';
comment on column public.tenancies.stripe_subscription_schedule_id is
  'The Stripe Subscription Schedule created to date-gate a rent increase; a later amount edit replaces its phase 2 rather than stacking a new schedule.';
