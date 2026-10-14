-- S714d (2026-10-14): show a scheduled cancel on Billing.
--
-- Found on S714's new-landlord run: after cancelling in the Stripe billing
-- portal, Billing still read "Active, current period ends November 14" with
-- no sign the cancel took. Stripe keeps the subscription active to the end of
-- the paid period and marks it cancel_at_period_end (or cancel_at). The
-- webhook now mirrors that date here; the page reads "Cancels on <date>".
-- Null = not cancelling (also cleared if the owner resumes in the portal).
--
-- GRANT check: a new column on public.organizations, covered by the existing
-- table-level grants (0001, 0007). Display only; the plan still follows the
-- subscription status. No new grant.

alter table public.organizations
  add column if not exists subscription_cancel_at timestamptz null;

comment on column public.organizations.subscription_cancel_at is
  'When the Stripe subscription is scheduled to end (cancel_at, or period end when cancel_at_period_end). Written by the Stripe webhook. Null = not cancelling.';
