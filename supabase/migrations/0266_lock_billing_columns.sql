-- S745a: a signed-in landlord (or teammate) could change their own plan,
-- subscription and Stripe ids through the public database API, because every
-- member may update their organization row (org_update policy) and the
-- authenticated role holds UPDATE on every column. Proven on 2026-11-02 in a
-- rolled-back transaction: plan 'growth' -> 'premium', status 'active'.
-- Only the posting add-on was guarded (0244).
--
-- After this migration only the server (service role, Stripe webhook, staff
-- tools) can change these columns. One move stays open to signed-in users:
-- 'trial' (the create_organization default) down to 'free', which the sign-up
-- and agent quick-onboard pages make with the new owner's own session.
--
-- Also: organization_feature_flags can switch any plan feature on for an org
-- (an override beats the plan). The only writer is the staff tool, which now
-- uses the service role, so landlords lose write access to it.
--
-- Deploy order: the app commit S745a first (startPilot, ensureCustomer and the
-- staff feature switch moved to the service role), then this migration.

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
  then
    raise exception 'billing and account fields can only be changed by Vacantless' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists organizations_guard_billing on public.organizations;
create trigger organizations_guard_billing
  before update on public.organizations
  for each row execute function public.organizations_guard_billing();

revoke insert, update, delete on public.organization_feature_flags from authenticated, anon;
