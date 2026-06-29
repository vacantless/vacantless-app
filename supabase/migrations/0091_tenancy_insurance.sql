-- ============================================================================
-- 0091_tenancy_insurance — per-tenancy renter's-insurance tracking (S382)
--
-- A new asset-style record, but anchored to a TENANCY (the tenant's policy)
-- rather than a unit. A landlord who requires proof of renter's / tenant
-- contents-and-liability insurance in the lease gets no warning today when a
-- policy lapses — leaving an uninsured tenant and a liability gap. This child
-- table stores the policy facts the landlord already collects as proof, and an
-- expiry date drives a per-tenancy landlord reminder (app/api/cron/tenancy-
-- insurance) ahead of the lapse so they can request renewed proof.
--
-- It is the tenancy-scoped sibling of the unit asset records (unit_detectors
-- 0080, unit_equipment 0081, unit_appliances 0082): same per-record date-
-- anchored reminder primitive (WORKFLOW 118), here the anchor is the policy's
-- EXPIRY date supplied directly (no install + service-life compute), and the
-- record hangs off the tenancy, not the property.
--
-- PII posture: stores insurance FACTS only — insurer name, policy number,
-- coverage amount, and dates. NO driver's licence / SIN / credit / NOA data
-- ever lands here, per the standing rule. The policy number is the landlord's
-- own proof-of-insurance record, not a government identifier.
--
-- Conventions mirror unit_equipment (0081) / work_orders (0054):
--   * organization_id is DENORMALIZED onto the row so RLS gates on
--     organization_id IN user_org_ids() with no join and the service-role cron
--     filters by org directly. on delete cascade with the tenancy (the record
--     has no meaning once the tenancy is gone).
--   * explicit grants (auto-expose of new tables is OFF); service_role gets DML
--     so the reminder cron never hits the silent permission-denied trap.
--
-- All additive; ships inert (no rows until a landlord logs a policy), and the
-- reminder is opt-in per org (isDripEnqueueEnabled) on top, so it ships dark.
-- ============================================================================

create table if not exists public.tenancy_insurance (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  tenancy_id       uuid not null references public.tenancies(id)     on delete cascade,

  -- The insurer / broker. Free text: "Square One", "TD Insurance".
  provider         text,
  -- The tenant's policy / certificate number (proof reference). Landlord's own
  -- record; not a government identifier.
  policy_number    text,
  -- Personal-liability coverage in cents (e.g. $1,000,000 = 100000000). Optional
  -- — many leases require a minimum liability amount the landlord likes on file.
  coverage_amount_cents bigint
                     check (coverage_amount_cents is null
                            or coverage_amount_cents >= 0),

  -- Policy period. effective_date is informational; expiry_date is the anchor
  -- for the lapse reminder (the policy is considered lapsed at/after this date).
  effective_date   date,
  expiry_date      date,

  -- Idempotency stamp for the reminder sweep: the expiry date this policy was
  -- last nudged FOR. Mirrors unit_equipment.eol_nudged_for — stamping the STABLE
  -- expiry date gates the email to once per policy term even while it sits in the
  -- lapsed band. Logging a renewal (new expiry date) makes the stamp mismatch and
  -- re-arms the next term. See lib/tenancy-insurance-sweep.ts.
  lapse_nudged_for date,

  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists tenancy_insurance_org_idx     on public.tenancy_insurance(organization_id);
create index if not exists tenancy_insurance_tenancy_idx on public.tenancy_insurance(tenancy_id);

comment on table public.tenancy_insurance is
  'Per-tenancy renter''s-insurance tracking (S382): insurer, policy number, coverage, dates. Feeds the per-tenancy lapse reminder (app/api/cron/tenancy-insurance). Tenancy-scoped sibling of the unit asset records. Stores insurance facts only — no DL/SIN/credit PII.';
comment on column public.tenancy_insurance.lapse_nudged_for is
  'Expiry date this policy was last nudged for by app/api/cron/tenancy-insurance; the once-per-term idempotency stamp (see lib/tenancy-insurance-sweep.ts).';
comment on column public.tenancy_insurance.expiry_date is
  'Policy expiry; the anchor for the lapse reminder. The policy is treated as lapsed at/after this date.';

-- ---------------------------------------------------------------------------
-- RLS — per-org, identical shape to unit_equipment (0081) and work_orders (0054).
-- ---------------------------------------------------------------------------
alter table public.tenancy_insurance enable row level security;

drop policy if exists tenancy_insurance_all on public.tenancy_insurance;
create policy tenancy_insurance_all on public.tenancy_insurance
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard capture UI; service_role for the reminder sweep.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.tenancy_insurance to authenticated;
grant select, insert, update, delete on public.tenancy_insurance to service_role;
