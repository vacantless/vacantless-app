-- 0097_showing_outcome_nudge.sql
-- S391, Slice 1: groundwork for the post-showing outcome nudge.
--
-- Once a showing's time has passed with no outcome recorded, the operator gets
-- ONE "how did the viewing go?" email with a one-tap token page that records
-- Attended / No-show / Cancelled. This migration adds the two columns that
-- machinery needs:
--   - outcome_nudge_sent_at: the single nudge stamp (mirrors reminder_*_sent_at);
--     one nudge per showing, so a re-run of the sweep never double-sends.
--   - outcome_token: an unguessable token for the UNAUTHENTICATED one-tap page
--     (NOT the showing id). NOT NULL DEFAULT gen_random_uuid() backfills a
--     distinct value into every existing row (volatile default = per-row), and
--     the unique index enforces no collisions going forward.
--
-- No RLS change: the one-tap write goes through a SECURITY DEFINER RPC keyed on
-- the token (added in a later slice), not through the authenticated showings
-- policy. Reversible (drop the columns + index).

alter table public.showings
  add column if not exists outcome_nudge_sent_at timestamptz,
  add column if not exists outcome_token uuid not null default gen_random_uuid();

create unique index if not exists showings_outcome_token_key
  on public.showings (outcome_token);
