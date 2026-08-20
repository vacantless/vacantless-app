-- ============================================================================
-- S668 - Standing per-org spend authorization for paid distribution channels.
--
-- Additive: extends the existing per-org/channel account row and adds an
-- append-only spend ledger. Paid worker claims remain closed unless the account
-- row carries a standing authorization and positive per-ad ceiling.
-- ============================================================================

alter table public.distribution_channel_accounts
  add column if not exists spend_authorized          boolean not null default false,
  add column if not exists spend_max_cents           integer,
  add column if not exists spend_period_max_cents    integer,
  add column if not exists spend_authorized_at       timestamptz,
  add column if not exists spend_authorized_by       uuid references auth.users(id) on delete set null,
  add column if not exists spend_revoked_at          timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'distribution_channel_accounts_spend_authorized_check'
      and conrelid = 'public.distribution_channel_accounts'::regclass
  ) then
    alter table public.distribution_channel_accounts
      add constraint distribution_channel_accounts_spend_authorized_check
      check (
        spend_authorized = false
        or (spend_max_cents is not null and spend_max_cents > 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'distribution_channel_accounts_spend_period_max_check'
      and conrelid = 'public.distribution_channel_accounts'::regclass
  ) then
    alter table public.distribution_channel_accounts
      add constraint distribution_channel_accounts_spend_period_max_check
      check (spend_period_max_cents is null or spend_period_max_cents > 0);
  end if;
end $$;

comment on column public.distribution_channel_accounts.spend_authorized is
  'S668: standing per-org/channel authorization for the worker to complete paid postings within the recorded ceilings.';
comment on column public.distribution_channel_accounts.spend_max_cents is
  'S668: per-ad ceiling in cents. May remain populated after revocation to preserve the authorization record.';
comment on column public.distribution_channel_accounts.spend_period_max_cents is
  'S668: optional per-calendar-month ceiling in cents. Null means no monthly cap.';
comment on column public.distribution_channel_accounts.spend_authorized_at is
  'S668: timestamp of the latest standing spend authorization grant.';
comment on column public.distribution_channel_accounts.spend_authorized_by is
  'S668: operator who granted the latest standing spend authorization.';
comment on column public.distribution_channel_accounts.spend_revoked_at is
  'S668: timestamp of the latest standing spend authorization revocation.';

-- S668 scaffolding: no runtime code writes this ledger yet. The paid-lane slice
-- on codex/s651-kijiji-paid-lane will write rows after charge completion when
-- checkout totals are threaded into its paid gate.
create table if not exists public.distribution_channel_spend (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  channel                   text not null,
  distribution_run_item_id  uuid references public.distribution_run_items(id) on delete set null,
  amount_cents              integer not null check (amount_cents > 0),
  currency                  text not null default 'CAD',
  external_url              text,
  charged_at                timestamptz not null default now(),
  created_at                timestamptz not null default now()
);

create index if not exists idx_distribution_channel_spend_org_channel_charged
  on public.distribution_channel_spend(organization_id, channel, charged_at);

alter table public.distribution_channel_spend enable row level security;
drop policy if exists distribution_channel_spend_all on public.distribution_channel_spend;
drop policy if exists distribution_channel_spend_read on public.distribution_channel_spend;
create policy distribution_channel_spend_read on public.distribution_channel_spend
  for select using (organization_id in (select public.user_org_ids()));

revoke all on public.distribution_channel_spend from anon;
revoke all on public.distribution_channel_spend from authenticated;
grant select on public.distribution_channel_spend to authenticated;
grant select, insert on public.distribution_channel_spend to service_role;

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
begin
  select
    automation_authorized,
    requires_payment,
    spend_authorized,
    spend_max_cents,
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

    message := format(
      'Worker refused paid claim for organization %s channel %s: %s. Prior approver: %s. Refused at %s. Authorize standing spend in Distribution settings, then approve again.',
      p_organization_id,
      p_channel,
      reason,
      coalesce(prior_approver::text, 'unknown'),
      now_ts
    );
    return query
      update public.distribution_run_items dri
      set audit_message = message,
          error_code = 'spend_authorization_required',
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
