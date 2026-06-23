-- ============================================================================
-- 0063_work_order_quote_timeline — operator-entered quote + expected dates on a
-- work order (Option B incident-dispatch, Slice 4 — the Option A ceiling).
--
-- Slice 4 lets an operator put a NUMBER and a TIMELINE on a work order so it can
-- be communicated to the tenant via the existing offer-to-send branded message
-- (lib/tenant-comms + lib/email). This is record-keeping + communication only:
--   * quote_cents     — the operator's ESTIMATE for the job, distinct from the
--                       existing cost_cents (the FINAL actual cost). The tenant
--                       sees the estimate up front; cost_cents is reconciled at
--                       completion for the owner statement.
--   * expected_start  — when the work is expected to begin.
--   * expected_finish — when it is expected to be done.
--
-- This is the WHOLE schema change for Slice 4. We deliberately do NOT add the
-- work_order_dispatches table yet — that two-way TRADE workflow is Slice 5 (the
-- guardrail amendment, gated on the Slice-0 ToS). The work-order spine stays the
-- single source of truth for the operator-entered ceiling; no money moves.
--
-- Idempotent ADD COLUMNs (same pattern as 0057's scope columns + 0058's deferred
-- FK). RLS + grants on work_orders are unchanged (per-org policy from 0054 still
-- gates every row); new nullable columns inherit them.
-- ============================================================================

alter table public.work_orders
  add column if not exists quote_cents     integer,
  add column if not exists expected_start  date,
  add column if not exists expected_finish date;

-- A quote, like cost_cents (0054), is a non-negative amount when present.
-- Guarded by its own named CHECK so it matches the cost_cents discipline and a
-- bad value can't be stored. Added separately (not inline) so the migration is
-- safe to re-run: drop-if-exists then add.
alter table public.work_orders
  drop constraint if exists work_orders_quote_cents_chk;
alter table public.work_orders
  add constraint work_orders_quote_cents_chk
  check (quote_cents is null or quote_cents >= 0);

comment on column public.work_orders.quote_cents is
  'Operator-entered ESTIMATE for the job (cents), communicated to the tenant. Distinct from cost_cents (the final actual cost). Slice 4.';
comment on column public.work_orders.expected_start is
  'Expected date work begins, communicated to the tenant. Slice 4.';
comment on column public.work_orders.expected_finish is
  'Expected date work is done, communicated to the tenant. Slice 4.';
