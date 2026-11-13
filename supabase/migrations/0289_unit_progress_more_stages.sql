-- ============================================================================
-- Vacantless - S788c: unit progress, the rest of the lifecycle.
-- ============================================================================
-- Checked against Agile's vacancy schedule (VACANT / RENO / RENTED, Date
-- Availability, Date Rented). Adds:
--   notice_given  the tenant gave notice (with the move-out date)
--   lease_signed  after the deposit clears and the unit is rented
--   moved_in      keys handed over, move-in check done
--   on_hold       not being rented (owner use, long reno)
--   due_date      the date a stage carries: move-out date (notice given),
--                 ready-by date (under construction, being cleaned), or the
--                 shoot date (photographer booked).
-- Additive.
-- ============================================================================

alter table public.unit_progress_events
  drop constraint if exists unit_progress_events_stage_check;

alter table public.unit_progress_events
  add constraint unit_progress_events_stage_check check (stage in (
    'notice_given', 'under_construction', 'being_cleaned', 'ready_for_photos',
    'photographer_booked', 'photos_in', 'touch_up', 'ready_to_post', 'live',
    'waiting_deposit', 'deposit_clearing', 'rented', 'lease_signed', 'moved_in',
    'on_hold', 'put_back_up'));

alter table public.unit_progress_events
  add column if not exists due_date date;
