-- 0163_reconciliation_statuses.sql -- Premium accounting reconciliation states.
--
-- Reconciliation uses the existing ledger links:
--   * debit -> expenses via bank_transactions.expense_id / expenses.bank_transaction_id
--   * credit -> rent_payments via rent_payments.bank_transaction_id
-- Explicit exclusions remain status-only and have no P&L effect.
--
-- Additive only: existing values stay valid, no new table, no RLS change. The
-- table already has org-scoped RLS and authenticated/service_role DML grants
-- from 0058.

alter table public.bank_transactions
  drop constraint if exists bank_transactions_triage_status_check;

alter table public.bank_transactions
  add constraint bank_transactions_triage_status_check
  check (triage_status in ('pending', 'assigned', 'ignored', 'rent', 'excluded'));
