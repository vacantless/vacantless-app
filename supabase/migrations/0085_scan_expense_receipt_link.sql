-- ============================================================================
-- 0085_scan_expense_receipt_link — link a scanned RECEIPT to the EXPENSE it
-- files (S366, the slice the S365 receipt->expense rail was laid for).
--
-- S365 (0084) shipped two halves: (1) the pending-document lifecycle that keeps
-- a scanned receipt image as a `documents` row, and (2) the receipt-mode ->
-- expense RAIL (lib/expenses.draftExpenseFromReceipt + the 'scan' source). What
-- 0084 deliberately left for "a later slice" was the UI that turns a scanned
-- receipt into an actual `expenses` row — and the LINK back from that expense to
-- the stored receipt image so the proof-of-purchase travels with the cost.
--
-- This adds that link as ONE nullable column, mirroring 0083's documents.appliance_id
-- exactly (the reusable "attach a document to a parent record" pattern, WORKFLOW
-- 121). A receipt document can now point at BOTH the appliance it documents
-- (appliance_id) AND the expense it filed (expense_id); either, both, or neither
-- may be set. So "scan a receipt on a unit page -> Log as a $X expense" stores
-- the image once and links it to the expense, the same way an appliance receipt
-- links to its appliance.
--
-- Additive + idempotent, safe to apply ahead of the code (ships INERT — no
-- document has an expense_id until a landlord logs a scanned receipt as an
-- expense). No tenant PII: a store receipt is a transaction record.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- documents.expense_id — the receipt -> expense link.
--
-- ON DELETE SET NULL, mirroring the table's existing appliance_id / tenancy_id /
-- person_id / lease_document_id posture: a document is never silently destroyed
-- by a parent cascade. There is no expense-deletion server action today, but if
-- one is added it must (like removeAppliance does for appliance_id, KI554)
-- soft-delete a now-unlinked receipt's bytes so SET NULL can't strand them in the
-- private bucket. A receipt linked to an expense is also, by construction, a
-- CONFIRMED document (not a pending capture): the log-as-expense action clears
-- pending_until when it links, and the document-retention reaper additionally
-- treats expense_id IS NOT NULL as "confirmed, never reap".
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists expense_id uuid
    references public.expenses(id) on delete set null;

create index if not exists documents_expense_idx
  on public.documents(expense_id, created_at desc);

comment on column public.documents.expense_id is
  'Optional link to the expenses (0058) row this document is the receipt / proof for (S366). Set when a scanned receipt is logged as an expense (lib/expenses source ''scan''). ON DELETE SET NULL (mirrors appliance_id/tenancy_id); a receipt with expense_id set is a confirmed doc (pending_until cleared on link) and is never reaped by document-retention.';
