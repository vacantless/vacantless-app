-- S712i: the worker's claim step enforces the per-ad and monthly spend limits.
-- Before this, only the app's cron and approve paths checked
-- spend_period_max_cents (lib/spend-cap.ts); the separate posting worker's
-- claim RPC checked only that a per-ad limit existed. Same counting rule as
-- lib/spend-cap.ts sumPeriodSpendCents: the charge ledger this calendar month
-- (Toronto time), plus each robot-posted run item this month with an ad link
-- and no ledger row at the site's list price (Kijiji $33.84).

create or replace function public.distribution_channel_list_price_cents(p_channel text)
returns integer
language sql
immutable
as $$
  select case p_channel when 'kijiji' then 3384 else 0 end;
$$;

create or replace function public.distribution_period_spend_cents(
  p_organization_id uuid,
  p_channel text,
  p_exclude_item_id uuid default null
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  start_ts timestamptz := (date_trunc('month', now() at time zone 'America/Toronto')) at time zone 'America/Toronto';
  ledger_total integer;
  fallback_total integer;
  price integer := public.distribution_channel_list_price_cents(p_channel);
begin
  select coalesce(sum(greatest(coalesce(s.amount_cents, 0), 0)), 0)::integer
  into ledger_total
  from public.distribution_channel_spend s
  where s.organization_id = p_organization_id
    and s.channel = p_channel
    and s.charged_at >= start_ts;

  if price > 0 then
    select (count(*) * price)::integer
    into fallback_total
    from public.distribution_run_items dri
    where dri.organization_id = p_organization_id
      and dri.channel = p_channel
      and dri.external_url is not null
      and dri.last_attempted_at >= start_ts
      and (p_exclude_item_id is null or dri.id <> p_exclude_item_id)
      and not exists (
        select 1 from public.distribution_channel_spend s2
        where s2.distribution_run_item_id = dri.id
          and s2.charged_at >= start_ts
      );
  else
    fallback_total := 0;
  end if;

  return ledger_total + coalesce(fallback_total, 0);
end;
$$;

revoke all on function public.distribution_period_spend_cents(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.distribution_period_spend_cents(uuid, text, uuid) to service_role;
grant execute on function public.distribution_channel_list_price_cents(text) to service_role;

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
