-- ============================================================================
-- 0036_tenancy_stripe_rent — link a tenancy to its Stripe Connect rent setup
-- (platform pivot step 2, ALT provider, increment 2: tenant mandate + customer; S215)
--
-- Sibling of 0030 (rotessa_customer_id). Increment 1 (0035) onboarded the
-- LANDLORD's Stripe connected account. This increment lets the dashboard:
--   * create a Stripe CUSTOMER on the connected account from the tenancy's
--     PRIMARY tenant (so a saved bank mandate can attach to it), and
--   * collect a PAD (acss_debit, CA) / ACH (us_bank_account, US) MANDATE via a
--     hosted Checkout setup session, storing the resulting payment method.
--
-- Model (unchanged, never-hold-funds): everything lives on the LANDLORD's
-- connected account (all calls carry the Stripe-Account header / direct charges)
-- — the tenant authorizes the landlord directly, exactly like Rotessa. We store
-- only Stripe's identifiers + a mandate status; NEVER bank/transit/account
-- numbers (Stripe holds those). The monthly subscription (increment 3) bills
-- this customer off the saved payment method.
--
--   * stripe_customer_id        — Customer id on the connected account (cus_...).
--   * stripe_setup_session_id   — the Checkout setup Session (cs_...) used to
--                                 collect the mandate; lets a Refresh look it up.
--   * stripe_payment_method_id  — the saved bank payment method (pm_...) once the
--                                 tenant completes authorization. NULL until then.
--   * stripe_mandate_status     — none | pending | active | failed. Drives the UI
--                                 and gates increment 3 (no subscription until active).
--   * stripe_rent_synced_at     — when we last created/refreshed this setup.
--
-- Additive + nullable (status defaults 'none'): no backfill, no constraint that
-- can fail on existing rows. Safe to apply ahead of the code deploy.
-- ============================================================================

alter table public.tenancies
  add column if not exists stripe_customer_id       text,
  add column if not exists stripe_setup_session_id  text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists stripe_mandate_status    text not null default 'none',
  add column if not exists stripe_rent_synced_at    timestamptz;

-- whitelist the mandate status (CHECK, not a pg enum, so extending is one line —
-- same convention as rent_payments.method in 0032)
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'tenancies' and constraint_name = 'tenancies_stripe_mandate_status_check'
  ) then
    alter table public.tenancies
      add constraint tenancies_stripe_mandate_status_check
      check (stripe_mandate_status in ('none', 'pending', 'active', 'failed'));
  end if;
end $$;
