-- ============================================================================
-- S553 Slice 1 - done-for-you posting WORKER authorization.
--
-- Additive only, no backfill. Two changes:
--   1. Per-org/per-channel automation consent on distribution_channel_accounts.
--      A concierge job is worker-eligible ONLY when its channel row has
--      automation_authorized = true. This is the per-channel dark gate (the
--      other gate is the DISTRIBUTION_WORKER_ENABLED env flag). auto_submit_allowed
--      is forward-looking: the Slice 1 worker never honors it (final submit stays
--      a human gate); the column exists so the model is complete for a later,
--      explicitly-consented slice.
--   2. Widen distribution_publish_attempts.actor_type to allow the new 'agent'
--      actor. The TS ATTEMPT_ACTOR_TYPES list and this DB CHECK must move
--      together, or a worker-recorded attempt insert would violate the constraint.
--
-- Deploy-safe: purely additive. The worker route no-ops on the missing columns
-- (it stays dark by env anyway), so code may deploy before this is applied.
-- ============================================================================

-- 1. Automation authorization on the per-channel account row.
alter table public.distribution_channel_accounts
  add column if not exists automation_authorized      boolean not null default false,
  add column if not exists automation_authorized_at    timestamptz,
  add column if not exists automation_authorized_by     uuid references auth.users(id) on delete set null,
  add column if not exists auto_submit_allowed          boolean not null default false;

comment on column public.distribution_channel_accounts.automation_authorized is
  'S553: the org has explicitly authorized the done-for-you worker to PREPARE posts on this channel. A concierge job is worker-eligible only when true. Dark by default.';
comment on column public.distribution_channel_accounts.auto_submit_allowed is
  'S553 forward-looking: per-channel consent for a future slice to click final submit. The Slice 1 worker NEVER reads this as true; final submit is a human gate. Payment is never automated in any slice.';

-- 2. Allow the 'agent' actor on the append-only attempt log. The constraint was
--    created inline (unnamed) in 0141; Postgres auto-names it
--    <table>_<column>_check. Drop-if-exists then re-add named so the migration is
--    idempotent and the new value is permitted.
alter table public.distribution_publish_attempts
  drop constraint if exists distribution_publish_attempts_actor_type_check;

alter table public.distribution_publish_attempts
  add constraint distribution_publish_attempts_actor_type_check
  check (actor_type in (
    'system', 'operator', 'concierge', 'browser_copilot', 'broker', 'agent'
  ));
