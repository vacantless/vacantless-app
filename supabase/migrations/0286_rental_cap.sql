-- ============================================================================
-- Vacantless - S779: door-band pricing (Noam approved 2026-11-10 17:10).
-- ============================================================================
-- organizations.rental_cap  how many rentals the account's paid plan covers.
--   Written only by the Stripe webhook from the plan price: Starter 5,
--   Growth 25, Portfolio 75 plus extra rentals bought at CA$2 each.
--   null = no limit: every account on the grandfathered CA$99 Growth price,
--   Premium, Managed, pilot, and Free (Free keeps its one-live-rental rule in
--   lib/billing.ts listingCapForPlan).
-- The billing guard (0266) gains the column so a signed-in owner cannot raise
-- their own limit through the API.
-- Additive: no existing row changes (every org starts at null = no limit).
-- GRANT check: a new column on public.organizations, covered by the existing
-- table grants (0001, 0007). No new grant.
-- ============================================================================

alter table public.organizations add column if not exists rental_cap integer;

create or replace function public.organizations_guard_billing()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.plan is distinct from old.plan
     and not (old.plan = 'trial' and new.plan = 'free') then
    raise exception 'plan can only be changed by Vacantless' using errcode = '42501';
  end if;

  if new.subscription_status is distinct from old.subscription_status
     or new.current_period_end is distinct from old.current_period_end
     or new.subscription_cancel_at is distinct from old.subscription_cancel_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.pilot_started_at is distinct from old.pilot_started_at
     or new.pilot_deposit_status is distinct from old.pilot_deposit_status
     or new.pilot_deposit_amount_cents is distinct from old.pilot_deposit_amount_cents
     or new.pilot_deposit_paid_at is distinct from old.pilot_deposit_paid_at
     or new.pilot_deposit_payment_intent_id is distinct from old.pilot_deposit_payment_intent_id
     or new.concierge is distinct from old.concierge
     or new.concierge_leaseup_cap_override is distinct from old.concierge_leaseup_cap_override
     or new.closed_at is distinct from old.closed_at
     or new.closed_by is distinct from old.closed_by
     or new.sms_provision_attempts is distinct from old.sms_provision_attempts
     or new.sms_provision_error is distinct from old.sms_provision_error
     or new.sms_provision_tried_at is distinct from old.sms_provision_tried_at
     or new.rental_cap is distinct from old.rental_cap
  then
    raise exception 'billing and account fields can only be changed by Vacantless' using errcode = '42501';
  end if;

  return new;
end;
$$;
