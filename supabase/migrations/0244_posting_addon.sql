-- S713 (Noam, 2026-10-13): the paid Posting add-on.
--
-- CA$49 a month on top of Growth ($99). It covers robot posting to Kijiji,
-- Rentals.ca and Zumper. Kijiji's own ad fees still pass through at cost under
-- the per-ad and monthly limits (0243). The Facebook Marketplace kit and the
-- Facebook Page / Instagram connections stay in every plan.
--
-- The app gate is lib/billing.ts canUseRobotPosting: a live paid plan
-- (growth / premium / managed) AND posting_addon_active. This migration adds
-- the columns, grandfathers Agile, stops a signed-in owner from switching the
-- flag on through the API, and teaches the worker claim RPC the same gate.
--
-- GRANT check: both columns land on public.organizations, which already has
-- table-level select, update to authenticated (0001) and service_role (0007).
-- New columns on an existing table are covered by those grants. No new grant.

alter table public.organizations
  add column if not exists posting_addon_active boolean not null default false,
  add column if not exists posting_addon_subscription_item_id text null;

comment on column public.organizations.posting_addon_active is
  'Posting add-on (robot posting to Kijiji, Rentals.ca, Zumper). Written by the Stripe webhook (service role) or this migration''s grandfathering. Gate = paid plan AND this flag.';
comment on column public.organizations.posting_addon_subscription_item_id is
  'Stripe subscription item id of the bought Posting add-on. Null with the flag on = grandfathered (never switched off by plan-only subscription events).';

-- Grandfather the owner's own paying org so its live posting keeps working.
-- By name, not a hardcoded id. No item id: the webhook leaves it alone.
update public.organizations
set posting_addon_active = true
where name = 'Agile Real Estate Group';

-- The flag is an entitlement. Owners can update their own org row through RLS
-- (org_update, 0001), so without this a signed-in owner could switch Posting on
-- for free with one API call. Only the service role (webhook) and migrations
-- may change these two columns; any other caller's change is quietly dropped.
create or replace function public.organizations_guard_posting_addon()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.posting_addon_active := old.posting_addon_active;
    new.posting_addon_subscription_item_id := old.posting_addon_subscription_item_id;
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_guard_posting_addon on public.organizations;
create trigger organizations_guard_posting_addon
  before update on public.organizations
  for each row
  execute function public.organizations_guard_posting_addon();

-- SQL twin of canUseRobotPosting, for the worker claim below.
create or replace function public.org_can_use_robot_posting(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.plan in ('growth', 'premium', 'managed') and o.posting_addon_active
       from public.organizations o
      where o.id = p_organization_id),
    false
  );
$$;

revoke all on function public.org_can_use_robot_posting(uuid) from public, anon, authenticated;
grant execute on function public.org_can_use_robot_posting(uuid) to service_role;

-- The worker claim RPC (0243 body, unchanged) plus one gate at the top: a
-- robot-posted site (kijiji, rentals_ca, zumper) is refused for an org without
-- the add-on. The refusal clears the approval and says why, the same way a
-- spend refusal does, so the item never sits approved and silently skipped.
create or replace function public.claim_approved_distribution_run_item_for_worker(
  p_item_id uuid,
  p_organization_id uuid,
  p_channel text,
  p_worker_claim_id uuid
)
returns table(id uuid, refused boolean, refusal_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  acct record;
  reason text;
  message text;
  now_ts timestamptz := now();
  prior_approver uuid;
  next_charge integer;
  spent integer;
  is_cap boolean := false;
begin
  -- S713: the Posting add-on gate (lib/billing.ts canUseRobotPosting).
  if p_channel in ('kijiji', 'rentals_ca', 'zumper')
     and not public.org_can_use_robot_posting(p_organization_id) then
    message := 'Part of the Posting add-on. $49 a month. Add it on the Billing page, then approve again.';
    return query
      update public.distribution_run_items dri
      set audit_message = message,
          error_code = 'posting_addon_required',
          error_message = message,
          operator_submit_approved_at = null,
          updated_at = now_ts
      where dri.id = p_item_id
        and dri.organization_id = p_organization_id
        and dri.channel = p_channel
        and dri.mode = 'concierge'
        and dri.publish_status = 'needs_operator'
        and dri.operator_submit_approved_at is not null
        and dri.concierge_claimed_by is null
      returning dri.id, true, 'posting_addon_required'::text;
    return;
  end if;

  select
    automation_authorized,
    requires_payment,
    spend_authorized,
    spend_max_cents,
    spend_period_max_cents,
    spend_revoked_at
  into acct
  from public.distribution_channel_accounts
  where organization_id = p_organization_id
    and channel = p_channel;

  if acct is null or acct.automation_authorized is distinct from true then
    return;
  end if;

  if acct.requires_payment is true then
    if acct.spend_authorized is distinct from true then
      reason := 'spend_not_authorized';
    elsif acct.spend_revoked_at is not null then
      reason := 'spend_revoked';
    elsif acct.spend_max_cents is null or acct.spend_max_cents <= 0 then
      reason := 'spend_max_missing';
    end if;

    -- S712i: the per-ad and monthly limits (lib/spend-cap.ts mirrors this).
    if reason is null then
      next_charge := public.distribution_channel_list_price_cents(p_channel);
      if next_charge <= 0 then
        next_charge := coalesce(acct.spend_max_cents, 0);
      end if;
      if next_charge > 0 and next_charge > acct.spend_max_cents then
        reason := 'spend_per_ad_cap';
        is_cap := true;
      elsif next_charge > 0 and coalesce(acct.spend_period_max_cents, 0) > 0 then
        spent := public.distribution_period_spend_cents(p_organization_id, p_channel, p_item_id);
        if spent + next_charge > acct.spend_period_max_cents then
          reason := 'spend_period_cap';
          is_cap := true;
        end if;
      end if;
    end if;
  end if;

  if reason is not null then
    select dri.operator_submit_approved_by
    into prior_approver
    from public.distribution_run_items dri
    where dri.id = p_item_id
      and dri.organization_id = p_organization_id
      and dri.channel = p_channel
      and dri.mode = 'concierge'
      and dri.publish_status = 'needs_operator'
      and dri.operator_submit_approved_at is not null
      and dri.concierge_claimed_by is null;

    if is_cap then
      message := case reason
        when 'spend_per_ad_cap' then format('This ad costs more than your limit of $%s per ad. Raise it in Settings.', to_char(acct.spend_max_cents / 100.0, 'FM999990.00'))
        else format('This would go over your monthly limit of $%s. Raise it in Settings.', to_char(acct.spend_period_max_cents / 100.0, 'FM999990.00'))
      end;
    else
    message := format(
      'Worker refused paid claim for organization %s channel %s: %s. Prior approver: %s. Refused at %s. Authorize standing spend in Distribution settings, then approve again.',
      p_organization_id,
      p_channel,
      reason,
      coalesce(prior_approver::text, 'unknown'),
      now_ts
    );
    end if;
    return query
      update public.distribution_run_items dri
      set audit_message = message,
          error_code = case when is_cap then reason else 'spend_authorization_required' end,
          error_message = message,
          operator_submit_approved_at = null,
          updated_at = now_ts
      where dri.id = p_item_id
        and dri.organization_id = p_organization_id
        and dri.channel = p_channel
        and dri.mode = 'concierge'
        and dri.publish_status = 'needs_operator'
        and dri.operator_submit_approved_at is not null
        and dri.concierge_claimed_by is null
      returning dri.id, true, reason;
    return;
  end if;

  return query
    update public.distribution_run_items dri
    set concierge_claimed_by = p_worker_claim_id,
        concierge_claimed_at = now_ts,
        publish_status = 'submitting',
        status = 'in_progress',
        last_attempted_at = now_ts,
        updated_at = now_ts
    where dri.id = p_item_id
      and dri.organization_id = p_organization_id
      and dri.channel = p_channel
      and dri.mode = 'concierge'
      and dri.publish_status = 'needs_operator'
      and dri.operator_submit_approved_at is not null
      and dri.concierge_claimed_by is null
      and exists (
        select 1
        from public.distribution_channel_accounts dca
        where dca.organization_id = dri.organization_id
          and dca.channel = dri.channel
          and dca.automation_authorized = true
          and (
            dca.requires_payment = false
            or (
              dca.spend_authorized = true
              and dca.spend_revoked_at is null
              and dca.spend_max_cents is not null
              and dca.spend_max_cents > 0
            )
          )
      )
    returning dri.id, false, null::text;
end;
$$;

grant execute on function public.claim_approved_distribution_run_item_for_worker(
  uuid,
  uuid,
  text,
  uuid
) to service_role;
