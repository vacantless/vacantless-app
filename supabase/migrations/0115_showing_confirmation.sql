-- ============================================================================
-- 0114_showing_confirmation — showing coordination trail, Slice 2 (S436).
--
-- WHY (dogfood, the "Howard" episode 2026-07-08): a booked viewing had no visible
-- state between "assigned" and "outcome", so the lead agent could not tell whether
-- the assigned agent had actually confirmed the appointment with the renter -
-- exactly the "did anyone follow up?" gap. This adds the confirmation state.
--
-- confirmed_at: when the appointment was confirmed with the renter. NULL = not yet
--   confirmed (the "awaiting confirmation" state). confirmed_by records WHO closed
--   it: 'lead' (the lead agent / operator marks it on the agent's behalf, the
--   Slice 2 path since showing agents are account-less) or 'agent' (reserved for
--   the Slice 3 tokenized agent self-confirm). CHECK not an enum so adding a value
--   later is one line.
--
-- Both columns are nullable and additive = live-safe (an org that never assigns or
-- confirms sees no change). No new RLS surface: confirmation is written through the
-- existing per-org showings policy by an authenticated member.
-- ============================================================================

alter table public.showings
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by text
    check (confirmed_by is null or confirmed_by in ('agent','lead'));
