-- Pilot tier (GTM Layer 1): a self-serve 30-day, founder-led pilot at $0/month
-- with a refundable $200 setup deposit (collected out-of-band for now). The org
-- is recorded as plan = 'pilot' with a pilot_started_at timestamp; the 30-day
-- end is DERIVED in tested TS (lib/billing.ts), not stored, so there's no second
-- field to keep in sync.
--
-- No new GRANT (organizations already granted to authenticated). `plan` is free
-- text (0001: `plan text not null default 'trial'`, no CHECK) so the new 'pilot'
-- value needs no constraint change. No RPC change. Pilots get full access because
-- no feature is gated on plan tier (the M5 differentiators are org toggles).
alter table public.organizations
  add column if not exists pilot_started_at timestamptz;
