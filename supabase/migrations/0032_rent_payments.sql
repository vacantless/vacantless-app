-- ============================================================================
-- 0032_rent_payments — manual rent-payment bookkeeping on a tenancy
-- (platform pivot step 2, the manual-payment-tracking complement, S212)
--
-- Rotessa (0029-0031) handles pre-authorized debit. But most small landlords
-- still collect rent by e-transfer / cheque / cash and just need a clean ledger
-- to record what came in and reconcile it against the rent owed — NOT another
-- payment processor. This table is that ledger: a row per payment RECEIVED
-- against a tenancy. We never move money here; we only record what the landlord
-- tells us they collected.
--
-- The `method` column is the payment-method abstraction. It is deliberately a
-- free-ish text with a CHECK whitelist (not a Postgres enum) so adding a method
-- later is a one-line CHECK change, not an ALTER TYPE. Today's whitelist is the
-- manual rails only — e_transfer / cheque / cash / other. We intentionally do
-- NOT add PayPal / Plastiq / Chexy (fees / tenant-side; see SESSION_LOG S211).
-- A future Rotessa-sourced mirror row could add 'pad' to the whitelist without
-- touching the shape.
--
--   * tenancy_id    — the tenancy this payment is for (cascade-delete with it).
--   * amount_cents  — integer cents, > 0.
--   * method        — one of the manual rails (CHECK whitelist).
--   * paid_on       — the date the payment was received.
--   * period_month  — OPTIONAL first-of-month date this payment is FOR, so the
--                     reconcile view can group payments by rent period and flag
--                     paid / short / over. NULL = unassigned (lump sum / deposit
--                     / misc) and shows in an "Unassigned" bucket.
--   * reference     — OPTIONAL cheque number / e-transfer reference.
--   * note          — OPTIONAL free text.
--
-- Conventions mirror the per-org tables in 0001 + the tenancy tables in 0028:
-- RLS gates rows on organization_id in (select public.user_org_ids()); explicit
-- grants because "auto-expose new tables" is OFF; service_role gets DML too so a
-- future reconcile/export cron won't hit the silent permission-denied trap
-- (migration 0007 lesson).
-- ============================================================================

create table if not exists public.rent_payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenancy_id      uuid not null references public.tenancies(id)     on delete cascade,

  amount_cents    integer not null check (amount_cents > 0),
  method          text    not null
                    check (method in ('e_transfer', 'cheque', 'cash', 'other')),
  paid_on         date    not null,
  -- first-of-month the payment is FOR (null = unassigned). The app always
  -- normalizes to the first of the month before writing.
  period_month    date,
  reference       text,
  note            text,

  created_at      timestamptz not null default now()
);

create index if not exists rent_payments_org_idx      on public.rent_payments(organization_id);
create index if not exists rent_payments_tenancy_idx  on public.rent_payments(tenancy_id);
create index if not exists rent_payments_paid_on_idx  on public.rent_payments(tenancy_id, paid_on);

-- ---------------------------------------------------------------------------
-- RLS — per-org, same shape as the operational tables in 0001 / 0028.
-- ---------------------------------------------------------------------------
alter table public.rent_payments enable row level security;

drop policy if exists rent_payments_all on public.rent_payments;
create policy rent_payments_all on public.rent_payments
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard; service_role for a future reconcile/export cron.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.rent_payments to authenticated;
grant select, insert, update, delete on public.rent_payments to service_role;
