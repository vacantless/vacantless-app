-- ============================================================================
-- 0029_rotessa_accounts — the landlord's BYO Rotessa connection (platform pivot
-- step 2: rent collection, S210)
--
-- Rent collection model (locked S210):
--   * The LANDLORD brings their own Rotessa account. Vacantless stores only
--     their API key, ENCRYPTED at rest (app-level AES-256-GCM; the key column
--     holds opaque ciphertext, never the raw token). See lib/crypto.ts.
--   * We NEVER store bank/PAD/account numbers and never hold funds — the
--     landlord's tenants authorize directly in Rotessa; Vacantless only
--     orchestrates schedules and READS status (transaction_report). This table
--     is therefore the connection record, not a wallet.
--   * One Rotessa account per organization (unique organization_id). A monthly
--     PAD schedule per tenancy will later bill that tenancy's PRIMARY tenant.
--
-- environment lets a landlord start in sandbox (sandbox-api.rotessa.com) and
-- flip to live (api.rotessa.com) once verified. connection_status + the
-- verify/error stamps drive the settings UI and let the upcoming nightly poll
-- cron skip orgs that aren't connected.
--
-- Conventions mirror 0028: RLS gates on organization_id in
-- (select public.user_org_ids()); explicit grants (auto-expose is OFF);
-- service_role gets DML so the future Rotessa nightly poll cron won't hit the
-- silent permission-denied trap.
-- ============================================================================

create table if not exists public.rotessa_accounts (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null unique
                        references public.organizations(id) on delete cascade,

  -- AES-256-GCM ciphertext of the landlord's Rotessa API token (never raw).
  -- NULL until the org connects; cleared on disconnect.
  api_key_encrypted   text,

  -- which Rotessa environment this key targets
  environment         text not null default 'sandbox'
                        check (environment in ('sandbox', 'live')),

  -- connection lifecycle, driven by the Test-connection action + the future cron
  connection_status   text not null default 'not_connected'
                        check (connection_status in ('not_connected', 'connected', 'error')),
  last_verified_at    timestamptz,
  last_error          text,

  -- optional display name surfaced by Rotessa on a successful verify
  rotessa_account_name text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists rotessa_accounts_org_idx
  on public.rotessa_accounts(organization_id);

-- ---------------------------------------------------------------------------
-- RLS — per-org, same shape as the operational tables in 0001 / 0028.
-- ---------------------------------------------------------------------------
alter table public.rotessa_accounts enable row level security;

drop policy if exists rotessa_accounts_all on public.rotessa_accounts;
create policy rotessa_accounts_all on public.rotessa_accounts
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit. authenticated for the settings UI; service_role for the
-- future rent-collection nightly poll cron.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.rotessa_accounts to authenticated;
grant select, insert, update, delete on public.rotessa_accounts to service_role;
