-- S743: the details Ontario's Standard Form of Lease (2229E) asks for that a
-- tenancy does not store (notice address, utilities, services, payment method,
-- key deposit, smoking, insurance). One JSON object per lease document, shaped
-- like lib/standard-lease.ts StandardLeaseDetails. RLS on lease_documents
-- already scopes it to the org.
alter table public.lease_documents
  add column if not exists standard_form jsonb not null default '{}'::jsonb;
