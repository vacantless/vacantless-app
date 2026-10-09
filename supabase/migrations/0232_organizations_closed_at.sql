-- S702: self-serve "Close this account" (Noam approved the soft-close design
-- 2026-10-08). The owner closes their own org from Settings; we record when and
-- by whom so the stored data can be deleted within 30 days (the promise on
-- /data-deletion). Additive, nullable, no backfill.
alter table public.organizations
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid;

comment on column public.organizations.closed_at is
  'S702: set when an owner closes the account from Settings. Rentals are taken off the market and logins removed at the same moment; data deletion follows within 30 days.';
