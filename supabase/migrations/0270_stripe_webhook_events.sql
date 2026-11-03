-- S748c: one row per Stripe event the webhook has taken on. Stripe delivers
-- at least once and retries; until now the route relied on every write being
-- idempotent. The route inserts the event id first: a second delivery of the
-- same id hits the primary key and is acknowledged without being processed.
-- A failed run deletes its row so Stripe's retry is processed. Service role only.
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  type text,
  received_at timestamptz not null default now()
);
create index if not exists stripe_webhook_events_received_idx on public.stripe_webhook_events (received_at);
alter table public.stripe_webhook_events enable row level security;
-- No policies on purpose: only the service role reads or writes it.
grant select, insert, delete on public.stripe_webhook_events to service_role;
