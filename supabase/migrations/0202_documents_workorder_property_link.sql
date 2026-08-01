-- ============================================================================
-- 0202_documents_workorder_property_link - work-order receipts in the vault
--
-- Smart-lock consumed migration 0201, so this S610 receipt-vault lane uses the
-- next free number. The document vault already exists (0076), already gained
-- doc_type='receipt' (0083), and stays org-scoped through the existing
-- documents_all RLS policy. This migration only adds nullable filing links so a
-- receipt can belong to a work order and surface on the rental/property view.
-- ============================================================================

alter table public.documents
  add column if not exists work_order_id uuid
    references public.work_orders(id) on delete set null;

alter table public.documents
  add column if not exists property_id uuid
    references public.properties(id) on delete set null;

create index if not exists documents_work_order_idx
  on public.documents(work_order_id, created_at desc);

create index if not exists documents_property_idx
  on public.documents(property_id, created_at desc);

comment on column public.documents.work_order_id is
  'Optional link to the work_orders row this document proves, typically a receipt for a completed maintenance job. ON DELETE SET NULL so the vault record survives work-order cleanup.';

comment on column public.documents.property_id is
  'Optional link to the properties row this document belongs to. Used for per-property vault views, including work-order receipts. ON DELETE SET NULL so the vault record survives unit cleanup.';
