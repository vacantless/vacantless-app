-- ============================================================================
-- 0121_outcome_nudge_cadence — bounded escalation for the post-showing outcome
-- nudge (S445, slice 2). Turns the one-shot nudge (0097) into a small, bounded
-- follow-up that STOPS the instant the outcome is recorded.
--
-- 0097 gave each showing a single outcome_nudge_sent_at (one nudge, ever). That is
-- too weak — one ignorable email is why 1-in-100 booked viewings ever get an
-- outcome. This adds:
--   showings.outcome_nudge_count      how many nudges have been sent (0..max)
--   organizations.outcome_nudge_max   the per-org cap = the "how often" policy:
--                                      1 = "just once", 3 = "follow up until
--                                      answered". Default 3 (follow-up). Off is the
--                                      existing per-org event toggle in Settings ->
--                                      Notifications (isDripEnqueueEnabled), so this
--                                      column never fires anything on its own.
-- outcome_nudge_sent_at is retained as the LAST-sent time (observability); the
-- COUNT drives the decision. The pure lib/reminders.outcomeNudgeStepDue gates the
-- Nth nudge on cumulative offsets from scheduled_at (fresh / next-morning / final),
-- the count, the cap, and the existing 7-day backlog bound. Additive; reversible.
-- ============================================================================

alter table public.showings
  add column if not exists outcome_nudge_count integer not null default 0;

alter table public.organizations
  add column if not exists outcome_nudge_max integer not null default 3;

-- 1 = just once, 3 = follow up (up to three, stopping on answer). Guard the range
-- so a bad write can't ask for an unbounded or zero cadence (off is the event
-- toggle, not a 0 here).
alter table public.organizations
  drop constraint if exists organizations_outcome_nudge_max_range;
alter table public.organizations
  add constraint organizations_outcome_nudge_max_range
  check (outcome_nudge_max between 1 and 3);
