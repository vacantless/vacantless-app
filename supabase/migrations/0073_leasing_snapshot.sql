-- 0073_leasing_snapshot
-- Scheduling state for the `leasing.daily_snapshot` digest (Agile→Vacantless
-- teardown — retires the old daily Zap 365197456). Two columns on organizations:
--   * leasing_snapshot_hour      — the org-local hour (0–23) at/after which the
--     weekday digest sends. Defaults to 16 (4pm) = the start of Aaliyah's shift,
--     matching the old Zap; per-org configurable later.
--   * leasing_snapshot_last_sent_on — the org-local calendar date the digest was
--     last sent. The cron pings every 15 min (the shared GitHub Actions sweep),
--     so this stamp gates it to exactly once per weekday (idempotent + catch-up
--     safe), the same posture as the reminder/nurture sweeps' sent-at columns.
-- No new table, no new function → no new advisor class. The on/off toggle, copy,
-- and recipients ride the existing notification_settings substrate (0067).

alter table public.organizations
  add column if not exists leasing_snapshot_hour smallint not null default 16,
  add column if not exists leasing_snapshot_last_sent_on date;

alter table public.organizations
  drop constraint if exists organizations_leasing_snapshot_hour_chk;
alter table public.organizations
  add constraint organizations_leasing_snapshot_hour_chk
  check (leasing_snapshot_hour between 0 and 23);

comment on column public.organizations.leasing_snapshot_hour is
  'Org-local hour (0-23) at/after which the weekday leasing.daily_snapshot digest sends. Default 16 (start of shift).';
comment on column public.organizations.leasing_snapshot_last_sent_on is
  'Org-local date the leasing.daily_snapshot digest was last sent; the once-per-weekday idempotency stamp for app/api/cron/leasing-snapshot.';
