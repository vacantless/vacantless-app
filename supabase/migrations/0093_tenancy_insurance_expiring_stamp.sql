-- ============================================================================
-- 0093_tenancy_insurance_expiring_stamp — phase-aware insurance reminder stamp
--   (S384, Codex finding on the S382 renter's-insurance reminder)
--
-- The renter's-insurance reminder contract promises TWO emails per policy term:
-- one ~30 days before expiry (expiring_soon) and one once the policy lapses. The
-- 0091 design carried a SINGLE idempotency stamp (lapse_nudged_for, keyed on the
-- expiry date), so the first email stamped the expiry and the SAME-expiry lapsed
-- email was then suppressed — the lapsed reminder never fired.
--
-- Fix: track the two phases with SEPARATE stamps. lapse_nudged_for now means the
-- LAPSED-phase stamp only; this column adds the pre-expiry (expiring_soon) stamp.
-- Each phase fires exactly once per term; a renewal (new expiry date) makes both
-- stamps mismatch and re-arms the next term. See lib/tenancy-insurance-sweep.ts
-- (decideInsuranceNudge) and app/api/cron/tenancy-insurance/route.ts.
--
-- Additive + inert: a new nullable date column, no backfill needed (a null stamp
-- simply means "not yet nudged this phase", which is the correct armed state).
-- ============================================================================

alter table public.tenancy_insurance
  add column if not exists expiring_nudged_for date;

comment on column public.tenancy_insurance.expiring_nudged_for is
  'Expiry date this policy was last nudged for in the PRE-EXPIRY (expiring_soon) phase by app/api/cron/tenancy-insurance; the once-per-term idempotency stamp for the ~30-days-out reminder. The lapsed-phase counterpart is lapse_nudged_for. See lib/tenancy-insurance-sweep.ts.';

comment on column public.tenancy_insurance.lapse_nudged_for is
  'Expiry date this policy was last nudged for in the LAPSED phase by app/api/cron/tenancy-insurance; the once-per-term idempotency stamp for the lapse reminder. The pre-expiry counterpart is expiring_nudged_for. See lib/tenancy-insurance-sweep.ts.';
