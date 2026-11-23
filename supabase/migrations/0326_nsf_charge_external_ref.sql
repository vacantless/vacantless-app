-- 0326_nsf_charge_external_ref.sql
-- S835d: NSF charges read from Rotessa's transaction report. Rotessa sends
-- Vacantless nothing when a debit fails, so a sweep reads the report and adds
-- the charge. external_ref ('rotessa:<transaction id>') makes it one charge
-- per failed transaction, however often the sweep runs. Additive only.

alter table public.tenancy_nsf_charges add column if not exists external_ref text;
create unique index if not exists tenancy_nsf_charges_external_ref_key
  on public.tenancy_nsf_charges (external_ref)
  where external_ref is not null;
