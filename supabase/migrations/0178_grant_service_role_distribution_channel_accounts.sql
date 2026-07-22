-- S553 grant-gap fix (same class as the S530 reminders incident).
-- distribution_channel_accounts (created in 0141) never granted service_role the
-- DML privileges the other distribution_* tables have, so the done-for-you worker's
-- service_role SELECT on it hit "permission denied", the route swallowed the error,
-- and every authorized job read as unauthorized (no_authorized_job). Grant the same
-- privileges the sibling tables (distribution_run_items/runs/publish_attempts) already
-- give service_role. RLS still applies to anon/authenticated; service_role bypasses
-- RLS but must still hold the table GRANT. Idempotent (re-granting is a no-op).
grant select, insert, update, delete on public.distribution_channel_accounts to service_role;
