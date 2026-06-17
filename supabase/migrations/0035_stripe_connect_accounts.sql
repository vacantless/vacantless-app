-- ============================================================================
-- 0035_stripe_connect_accounts — the landlord's Stripe Connect rent rail
-- (platform pivot step 2, ALT provider; S215). Sibling to 0029_rotessa_accounts.
--
-- Why a second rail: Rotessa's sandbox is request-only (a single-vendor gate
-- that has blocked live verification). Stripe Connect is a self-serve,
-- instantly-testable backup that also covers Canada PAD (acss_debit) AND US ACH
-- (us_bank_account) in one integration. The landlord picks a rail; this table is
-- the Stripe side of that choice.
--
-- Model (never-hold-funds, same posture as Rotessa):
--   * STANDARD connected account + DIRECT charges. The LANDLORD is the merchant
--     of record; funds settle straight to their Stripe account; the platform is
--     NOT liable for negative balances and NEVER holds funds.
--   * We store only the connected account id (acct_...) + a cached status
--     snapshot — NO secret key (cleaner than the Rotessa BYO key; all calls use
--     the platform key + a Stripe-Account header). NO bank/PAD numbers ever.
--   * Test vs live is decided by the platform's Stripe key (sk_test / sk_live),
--     so there is no per-row environment column (unlike Rotessa).
--   * One Stripe connection per organization (unique organization_id).
--
-- charges_enabled / capability statuses / onboarding_state drive the Settings UI
-- and let the upcoming tenancy-level rent build skip orgs that aren't ready.
--
-- Conventions mirror 0028 / 0029: RLS gates on organization_id in
-- (select public.user_org_ids()); explicit grants (auto-expose is OFF);
-- service_role gets DML so a future webhook-driven sync (service_role) won't hit
-- the silent permission-denied trap.
-- ============================================================================

create table if not exists public.stripe_connect_accounts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null unique
                          references public.organizations(id) on delete cascade,

  -- the landlord's Stripe connected account id (acct_...). NOT a secret.
  connected_account_id  text not null,

  -- ISO country of the connected account (drives PAD-CAD vs ACH-USD currency)
  country               text,

  -- cached snapshot from accounts.retrieve, refreshed by the Settings action
  -- (and, later, the webhook). The connected account is the source of truth.
  charges_enabled       boolean not null default false,
  payouts_enabled       boolean not null default false,
  details_submitted     boolean not null default false,

  -- per-rail capability status. Stripe returns active|inactive|pending; a
  -- capability we requested but Stripe hasn't surfaced reads 'unrequested'.
  acss_status           text not null default 'unrequested'
                          check (acss_status in ('active', 'inactive', 'pending', 'unrequested')),
  ach_status            text not null default 'unrequested'
                          check (ach_status in ('active', 'inactive', 'pending', 'unrequested')),

  -- derived lifecycle for the UI: not_started -> incomplete -> ready
  onboarding_state      text not null default 'not_started'
                          check (onboarding_state in ('not_started', 'incomplete', 'ready')),

  last_synced_at        timestamptz,
  last_error            text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists stripe_connect_accounts_org_idx
  on public.stripe_connect_accounts(organization_id);

-- ---------------------------------------------------------------------------
-- RLS — per-org, same shape as 0028 / 0029.
-- ---------------------------------------------------------------------------
alter table public.stripe_connect_accounts enable row level security;

drop policy if exists stripe_connect_accounts_all on public.stripe_connect_accounts;
create policy stripe_connect_accounts_all on public.stripe_connect_accounts
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit. authenticated for the settings UI; service_role for the
-- future webhook-driven status sync.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.stripe_connect_accounts to authenticated;
grant select, insert, update, delete on public.stripe_connect_accounts to service_role;
