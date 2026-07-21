-- 0175_listing_health_alerts
-- Idempotency stamp for the opt-in S548 listing-health email digest.
-- Additive only: no existing listing_posts rows are changed, and portal state
-- remains fully manual/operator-owned.

alter table public.listing_posts
  add column if not exists last_health_alerted_at timestamptz;

comment on column public.listing_posts.last_health_alerted_at is
  'Last time Vacantless sent an operator listing-health digest for this tracked post. Null means never alerted.';

create index if not exists idx_listing_posts_last_health_alerted
  on public.listing_posts(organization_id, last_health_alerted_at)
  where last_health_alerted_at is not null;
