-- ============================================================================
-- Vacantless - S796b: stop rent after one last payment.
-- ============================================================================
-- A landlord ending a tenancy usually wants the final rent payment to go
-- through first and the automatic debit to stop after it. rent_stop_after is
-- the date of that last payment. While it is set, the rent-stop sweep
-- (/api/cron/rent-stop) waits for the payment on or after that date to clear,
-- then cancels the debit and clears the column. Null = no stop is scheduled.
-- ============================================================================
alter table public.tenancies
  add column if not exists rent_stop_after date;

comment on column public.tenancies.rent_stop_after is
  'Date of the last automatic rent payment to take; the rent-stop sweep cancels the debit once that payment clears. Null = no stop scheduled.';
