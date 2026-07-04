-- ============================================================================
-- 0104_bank_import — file-import (OFX/QFX now, CSV later) for the bank-feed
-- expense module (S411). Additive only: no destructive change, no backfill.
-- See CSV-OFX-BANK-FEED-IMPORT-SPEC-2026-07-01.md.
--
-- The live aggregator feed (Plaid/Flinks, migration 0058) covers RBC / TD /
-- Amex-CA, but issuers Plaid and Flinks don't support (e.g. MBNA) can't connect.
-- The no-credential way to offer those is to let the owner upload the issuer's
-- OWN transaction export and run it through the EXACT same pipeline. An imported
-- account becomes a SYNTHETIC connection (provider='csv', NO row in
-- bank_connection_secrets — there is no pull token), and every imported
-- transaction hangs off it exactly like a Plaid transaction, so
-- filterNewTransactions, autoApplyRules, the triage UI, and buildOwnerStatement
-- all work unchanged (they only ever see NormalizedTxn / bank_transactions rows).
--
-- PII: uploads are TRANSACTION exports only (no PDF statements). The raw OFX
-- <ACCTID> is masked to last-4 in the app before insert and never persisted.
-- ============================================================================

-- 1) Allow a synthetic 'csv' connection alongside the live aggregators. A 'csv'
--    connection is a manually-managed imported account with no secret row and is
--    never touched by the Plaid sync cron.
alter table public.bank_connections drop constraint if exists bank_connections_provider_check;
alter table public.bank_connections
  add constraint bank_connections_provider_check
  check (provider in ('plaid','flinks','csv'));

-- 2) Record which format an imported connection uses (null for live aggregator
--    connections) so the UI can label it and pick the default re-import parser.
alter table public.bank_connections
  add column if not exists import_format text
    check (import_format is null or import_format in ('ofx','csv'));

-- 3) Self-describe a transaction's origin so the ledger + triage UI can badge
--    imported rows. Live-feed inserts default to 'live' with ZERO code change at
--    the existing insert sites.
alter table public.bank_transactions
  add column if not exists source text not null default 'live'
    check (source in ('live','import'));

-- RLS: the existing per-org bank_connections_all / bank_transactions_all policies
-- already scope the new rows by organization_id. No new policy, no new grant — a
-- csv connection is just another org-scoped row with no secret.
