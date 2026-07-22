-- ============================================================================
-- 0181_distribution_operator_submit_approval — the per-job "Approve & submit"
-- signal for the done-for-you posting worker (S555 Slice 2, Phase B).
--
-- WHY THIS EXISTS. The Phase-B worker claims an authorized concierge job, drives
-- the portal with a reused session behind a residential proxy, FILLS the post
-- form, screenshots it, moves the item to `needs_operator`, and STOPS — it never
-- clicks final submit (the human gate; payment is never automated). This adds the
-- signal a human sets from the concierge desk to say "I reviewed the prepared
-- post, go ahead and submit it": the worker's approval-read pass (a separate
-- deployable, not the Vercel app) only completes a submit for an item whose
-- operator_submit_approved_at is set.
--
-- MODEL. ABSENCE of a value == today's behavior exactly. Both columns are
-- nullable with no default and no backfill, so every existing row reads as
-- "not approved" and nothing in the current app or worker path changes until an
-- operator explicitly approves an item. This is dark by construction — it is a
-- new nullable signal, not a behavior switch.
--
-- Deploy-safe: the app only WRITES these columns from the new approveConciergeSubmit
-- server action (superadmin-gated); the worker READS them. A deploy that lands
-- before this migration simply never sets the signal (the action's guarded UPDATE
-- matches on the column and no-ops), rather than erroring.
--
-- Grants: distribution_run_items already grants the app (authenticated, RLS-scoped)
-- and the worker (service_role) full DML, so adding columns needs no new grant
-- (the KI850 grant-gap class applies to NEW tables, not new columns on a granted
-- table). No RLS change: the existing row policies cover these columns.
-- ============================================================================

alter table public.distribution_run_items
  -- When an operator approved the agent-prepared post for final submit. Null =
  -- not yet approved (the default state; the worker will not submit).
  add column if not exists operator_submit_approved_at timestamptz,
  -- Which operator approved it. Plain uuid with no FK, matching concierge_claimed_by
  -- on this same table (both are set to the acting auth user's id).
  add column if not exists operator_submit_approved_by uuid;

-- The worker's approval-read pass scans for concierge items that have been
-- approved but not yet completed. A partial index keeps that scan cheap without
-- widening the table's write path for the (common) unapproved rows.
create index if not exists distribution_run_items_submit_approved_idx
  on public.distribution_run_items (operator_submit_approved_at)
  where operator_submit_approved_at is not null and mode = 'concierge';
