-- 0107_rent_from_bank.sql — record rent income from a bank CREDIT (S417).
--
-- The bank-feed import stores incoming money as `bank_transactions` with
-- direction='credit', but the expense triage only surfaces debits, so a rent
-- deposit (e.g. a Rotessa lump covering several tenancies) had NO path to become
-- "Rent collected" on the owner statement. This adds the audit link so a credit
-- can be split across tenancies into `rent_payments` rows that the statement
-- already sums — reversible, and double-record-guarded (a credit leaves the
-- review lane once assigned).
--
-- Purely additive: both columns are nullable/defaulted, existing code never
-- reads them, and RLS/grants are inherited (no policy change). We never move
-- money — this only records what already landed.

alter table public.rent_payments
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'bank')),
  add column if not exists bank_transaction_id uuid
    references public.bank_transactions(id) on delete set null;

-- One credit fans out to one rent_payments row per tenancy, so this is NOT
-- unique; the index just speeds "which rent came from this deposit" (reversal +
-- the already-recorded guard).
create index if not exists rent_payments_bank_txn_idx
  on public.rent_payments (bank_transaction_id)
  where bank_transaction_id is not null;
