-- ============================================================================
-- 0084_pending_capture_and_scan_expense — Phase 2 of the photo-OCR capture
-- (CAPTURE-PHASE2-PENDING-DOC-LIFECYCLE-2026-06-28.md). Two additive, idempotent
-- changes, both safe to apply ahead of the code (ships INERT — no pending rows
-- exist until a landlord scans with the engine on, and pending_until is NULL on
-- every pre-existing document so nothing changes for confirmed docs).
--
-- 1. documents.pending_until — the pending-document LIFECYCLE.
--    Phase 1 (S364) scanned a plate/receipt, parsed fields, then DISCARDED the
--    image. Phase 2 keeps that image as the appliance's receipt/proof. But at
--    scan time the appliance does not exist yet (the form is only prefilled, not
--    saved) and the landlord may abandon the form — so the byte is stored BEFORE
--    it has anything to link to, and must be guaranteed to be either linked or
--    reaped. A scanned capture is a `documents` row (private bucket, org RLS,
--    signed URLs — all inherited from 0076) that is UNCONFIRMED until the
--    landlord saves the appliance:
--      * pending_until NULL      = a normal confirmed document (every existing row).
--      * pending_until NOT NULL  = an unconfirmed scan capture: bytes uploaded,
--                                  appliance_id still NULL, awaiting confirm-or-reap.
--    On confirm (addAppliance) the row is promoted: appliance_id set, pending_until
--    -> NULL, it becomes a normal receipt. If abandoned, app/api/cron/document-
--    retention reaps it (removes bytes + hard-deletes the row) once pending_until
--    has passed — so no bytes are ever orphaned in the bucket.
--
--    A dedicated column (NOT overloading retention_until) keeps the two lifecycles
--    disjoint: the retention purge acts only on deleted_at IS NOT NULL rows; the
--    reap acts only on pending_until IS NOT NULL AND deleted_at IS NULL rows. A
--    pending capture is invisible to every existing list query by construction
--    (the appliance receipt strip filters appliance_id; tenancy/person vault lists
--    filter tenancy_id/person_id — all NULL while pending), so no UI change hides it.
--
-- 2. expenses.source += 'scan' — the receipt-mode -> expense RAIL.
--    A purchase receipt scanned by the same engine yields merchant/date/total;
--    lib/expenses.draftExpenseFromReceipt maps that to an ExpenseInput. This adds
--    the provenance value so a scanned-receipt expense is attributable distinct
--    from manual/bank/import. (The expense-creation UI is a later slice; this lays
--    the rail.) No tenant PII: a store receipt is a transaction record.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. documents.pending_until — the unconfirmed-scan-capture marker.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists pending_until timestamptz;

-- Partial index for the reaper sweep (pending rows are few + transient).
create index if not exists documents_pending_idx
  on public.documents(pending_until)
  where pending_until is not null;

comment on column public.documents.pending_until is
  'NULL = a normal confirmed document. NOT NULL = an unconfirmed scan capture (S365 Phase 2): bytes uploaded but appliance_id still NULL, awaiting confirm (addAppliance promotes it: appliance_id set, pending_until -> NULL) or reap (app/api/cron/document-retention removes bytes + deletes the row once pending_until has passed). Keeps the lifecycle disjoint from the deleted_at/retention_until purge.';

-- ---------------------------------------------------------------------------
-- 2. expenses.source += 'scan'. The 0058 CHECK is an inline (auto-named)
--    constraint; drop it by the conventional name and recreate it named with the
--    value added. Idempotent: drop-if-exists then add.
-- ---------------------------------------------------------------------------
alter table public.expenses
  drop constraint if exists expenses_source_check;

alter table public.expenses
  add constraint expenses_source_check
  check (source in ('manual', 'bank', 'import', 'scan'));
