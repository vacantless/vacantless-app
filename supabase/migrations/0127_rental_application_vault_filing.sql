-- 0127_rental_application_vault_filing.sql
-- S456, Slice 1b: file a SUBMITTED application's NON-SENSITIVE summary PDF into
-- the document vault (0076). Adds a back-link from the application to the filed
-- `documents` row so the lead-detail card can show "Filed to vault" + a download,
-- and so re-filing is idempotent (the action checks filed_document_id first).
--
-- Additive + nullable ONLY: two new columns on an existing table, one FK with
-- ON DELETE SET NULL (so hard-deleting the vault doc later just clears the link,
-- never removes the application). No RLS change, no data backfill, no change to
-- existing columns. Reversible. Model B is unaffected — no PII column is added;
-- the filed artifact is the non-sensitive summary only.

alter table public.rental_applications
  add column if not exists filed_document_id uuid
    references public.documents(id) on delete set null,
  add column if not exists filed_to_vault_at timestamptz;

comment on column public.rental_applications.filed_document_id is
  'S456: the documents(0076) row holding the filed non-sensitive application summary PDF, or null.';
comment on column public.rental_applications.filed_to_vault_at is
  'S456: when the operator filed the application summary into the vault, or null.';
