-- ============================================================================
-- 0201_unit_smart_lock - smart-lock battery reminder flag (S610)
--
-- Adds an operator-only unit feature flag for rentals with smart locks, plus the
-- once-per-cycle stamp used by app/api/cron/smart-lock-battery. The reminder is
-- dark by data: every existing and future unit defaults has_smart_lock = false,
-- so the sweep has no candidates until a landlord deliberately flags a unit.
--
-- The columns live on public.properties beside the sibling unit-feature booleans
-- from 0013 (air_conditioning, balcony, furnished, utilities, etc.). properties
-- already carries org-scoped RLS; the service-role cron still filters by
-- organization_id explicitly before reading/updating these fields.
-- ============================================================================

alter table public.properties
  add column if not exists has_smart_lock boolean not null default false,
  add column if not exists last_smart_lock_battery_reminder_at timestamptz;

create index if not exists properties_smart_lock_battery_idx
  on public.properties(organization_id, last_smart_lock_battery_reminder_at)
  where has_smart_lock = true;

comment on column public.properties.has_smart_lock is
  'Operator-only unit feature: this rental has a smart lock whose batteries should be replaced on the recurring smart-lock battery reminder cadence. Defaults false so the reminder ships dark.';
comment on column public.properties.last_smart_lock_battery_reminder_at is
  'Timestamp last smart-lock battery reminder sent for this unit by app/api/cron/smart-lock-battery; used as the recurring idempotency stamp.';
