-- ============================================================================
-- Vacantless — M3 follow-on: showing reminders (sent-at bookkeeping)
-- ============================================================================
-- Adds two nullable timestamps to `showings` so the reminder sweep can be
-- idempotent + catch-up safe: it only sends a reminder whose column is still
-- NULL, then stamps it. No double-sends even if the cron runs many times.
--
--   * reminder_24h_sent_at — when the ~24h-before reminder was sent.
--   * reminder_2h_sent_at  — when the ~2h-before reminder was sent.
--
-- The sweep itself runs in the Vercel cron route (app/api/cron/reminders),
-- which uses the service-role key to read upcoming showings across all orgs
-- (RLS would otherwise hide them) and to stamp these columns + log the
-- timeline. No anon RPC is added on purpose: exposing renter contact info to
-- the public key would let anyone scrape lead PII. Run once after 0005.
-- ============================================================================

alter table public.showings
  add column if not exists reminder_24h_sent_at timestamptz,
  add column if not exists reminder_2h_sent_at  timestamptz;

-- Helps the sweep find the small set of soon-upcoming scheduled showings fast.
create index if not exists idx_showings_upcoming_scheduled
  on public.showings (scheduled_at)
  where outcome = 'scheduled';
