-- 0139 (S474b): concierge "Publish for me" queue on distribution_run_items.
--
-- The one-click Publish Run (S467/0137) already models per-channel mode + status
-- and includes a `concierge` mode. This adds the staff-queue plumbing so an
-- operator can hand a human-action channel (Kijiji/Facebook/broker/custom that
-- needs a login/payment/manual post) to the Vacantless publishing desk: the item
-- flips to mode='concierge' + publish_status='queued', a staff member claims it,
-- posts it, and marks it live (which produces the tracked listing_posts row).
--
-- Each concierge request is one countable done-for-you unit — these rows ARE the
-- billing meter, so quota/overage pricing can be layered on later with no rebuild.
--
-- Additive + non-breaking. mode/publish_status are already constrained (0137);
-- 'concierge' is an allowed mode and queued/submitting/live/rejected/skipped are
-- allowed publish_status values, so no constraint change is needed here.

alter table public.distribution_run_items
  add column if not exists concierge_requested_at timestamptz,
  add column if not exists concierge_requested_by uuid,
  add column if not exists concierge_claimed_by  uuid,
  add column if not exists concierge_claimed_at  timestamptz;

comment on column public.distribution_run_items.concierge_requested_at is
  'When the operator clicked "Publish for me" (hand-off to the Vacantless publishing desk). Each request = one countable done-for-you unit (billing meter). Null = not a concierge request.';
comment on column public.distribution_run_items.concierge_requested_by is
  'auth.users id of the operator who requested concierge posting.';
comment on column public.distribution_run_items.concierge_claimed_by is
  'auth.users id of the Vacantless staff member who claimed this item off the concierge queue.';
comment on column public.distribution_run_items.concierge_claimed_at is
  'When a staff member claimed this item (avoids two staff posting the same listing).';
