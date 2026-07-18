-- S515b root-cause fix: the availability-tripwire cron (and any other service_role
-- admin path) could not read the availability tables — service_role was missing
-- SELECT on availability_rules / availability_days_off / availability_overrides,
-- causing "permission denied for table availability_rules" and a per-org throw
-- before the tripwire could compute severity or stamp state. Grant read access to
-- match showings/organizations. Read-only, reversible, no data change.
-- Applied to prod via Supabase MCP on 2026-07-18.
grant select on table
  public.availability_rules,
  public.availability_days_off,
  public.availability_overrides
to service_role;
