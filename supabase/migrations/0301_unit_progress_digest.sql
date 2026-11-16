-- S803: one email per batch of crew taps (lib/unit-progress-digest.ts). A tap
-- that needs the landlord holds its line here; the 15-minute sweep sends one
-- email per crew member once they stop tapping, then clears the flag.
alter table public.unit_progress_events
  add column if not exists notify_line text,
  add column if not exists notify_pending boolean not null default false,
  add column if not exists notified_at timestamptz;

create index if not exists unit_progress_events_notify_pending_idx
  on public.unit_progress_events (created_at)
  where notify_pending;
