-- 0078_org_invites_optional_email.sql
-- Slice 2 (referral loop, S355): a landlord-generated referral link can be made
-- with NO friend details at all — the friend self-creates their own account, so
-- the referrer's invited_email is just an optional label for their own tracking.
-- The 0077 table declared invited_email NOT NULL (correct for the operator path,
-- which always knows the landlord's email), so relax it for the referral path.
--
-- Safe + additive: dropping NOT NULL never invalidates existing rows. The
-- partial-unique index org_invites_provisioned_email_uniq (on lower(invited_email)
-- where status='provisioned') is unaffected — provisioned rows come from the
-- operator path and always carry an email, and NULLs are excluded from unique
-- comparisons regardless.
alter table public.org_invites
  alter column invited_email drop not null;
