-- ============================================================================
-- 0083_appliance_receipts — link a stored RECEIPT (or purchase proof) to an
-- appliance, reusing the existing document vault (0076). The slice deferred from
-- 0082: "The purchase RECEIPT is a later slice: a documents-vault row linked
-- back to the appliance."
--
-- An appliance (unit_appliances, 0082) is a durable good the landlord bought;
-- the proof of purchase — a PDF or a phone photo of the till receipt — is the
-- artifact you need to (a) claim the manufacturer warranty and (b) prove the
-- purchase date that anchors the warranty/consumable clocks. Rather than a new
-- storage bucket + RLS + signed-URL plumbing, a receipt is just another
-- `documents` row (private bucket, org-scoped RLS, short-lived signed URLs,
-- soft-delete + the retention purge cron) — it inherits the vault's entire
-- security posture for free. This migration only adds the LINK + a doc type.
--
-- Two additive changes, both safe to apply ahead of the code (ships inert — no
-- receipts exist until a landlord uploads one):
--   1. documents.appliance_id — a nullable FK to unit_appliances. ON DELETE SET
--      NULL, mirroring the table's existing tenancy_id / person_id /
--      lease_document_id posture (a document is never silently destroyed by a
--      cascade). The appliance-removal server action explicitly soft-deletes a
--      unit's receipts (removing the bytes + stamping retention) BEFORE deleting
--      the appliance, so SET NULL never strands billable bytes in the bucket;
--      this column is the belt to that action's braces.
--   2. doc_type gains 'receipt' so an appliance receipt is typed correctly in the
--      vault taxonomy (lib/documents.DOCUMENT_TYPES) instead of falling into
--      'other'. The CHECK is dropped + recreated to add the value.
--
-- No tenant PII: a purchase receipt is a store transaction record (merchant,
-- amount, the appliance), not a person's protected data; it lives in the same
-- private, org-gated bucket as the rest of the vault regardless.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. documents.appliance_id — the receipt -> appliance link.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists appliance_id uuid
    references public.unit_appliances(id) on delete set null;

create index if not exists documents_appliance_idx
  on public.documents(appliance_id, created_at desc);

comment on column public.documents.appliance_id is
  'Optional link to the unit_appliances (0082) row this document is the receipt / purchase proof for. ON DELETE SET NULL (mirrors tenancy_id/person_id); the appliance-removal action soft-deletes a unit''s receipts first so no bytes are stranded.';

-- ---------------------------------------------------------------------------
-- 2. doc_type += 'receipt'. The 0076 CHECK is an inline (auto-named) constraint;
--    drop it by the conventional name and recreate it named, with 'receipt'
--    added. Idempotent: drop-if-exists then add.
-- ---------------------------------------------------------------------------
alter table public.documents
  drop constraint if exists documents_doc_type_check;

alter table public.documents
  add constraint documents_doc_type_check
  check (doc_type in (
    'lease', 'amendment', 'notice', 'insurance',
    'id_package', 'statement', 'receipt', 'other'
  ));
