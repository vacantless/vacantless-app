-- ============================================================================
-- 0090 — sender round-trip confirmation (S379 capture/ingress audit F4).
--
-- Today a verified sender is created already-trusted (verified_at = now() in the
-- provisioning action), so an operator can mark any address trusted without
-- proving control of it. F4 makes a sender EARN trust: it is added unverified,
-- emailed a one-time confirmation link, and only gets verified_at once the link
-- is clicked. The inbound webhook already admits ONLY senders with
-- verified_at IS NOT NULL, so an unconfirmed sender simply never captures.
--
-- This migration is ADDITIVE and touches ZERO existing rows:
--   - two nullable columns on org_ingest_senders;
--   - a partial index on the token hash (only non-null tokens, i.e. pending rows).
-- Existing senders keep their verified_at as-is — they were added by the operator
-- in earlier slices and stay trusted; F4 changes how NEW senders are verified, it
-- does not re-confirm anyone retroactively.
-- ============================================================================

alter table public.org_ingest_senders
  -- sha256 (hex) of the single-use raw confirm token; the raw token is only ever
  -- in the emailed link, never stored. NULL once confirmed (single-use) or for a
  -- pre-existing already-verified sender.
  add column if not exists confirm_token_sha256 text,
  -- when the confirmation email was last sent — drives the 72h expiry and the
  -- resend throttle.
  add column if not exists confirm_sent_at timestamptz;

-- The confirm route looks a row up by token hash; index only the pending ones.
create index if not exists org_ingest_senders_confirm_token_idx
  on public.org_ingest_senders(confirm_token_sha256)
  where confirm_token_sha256 is not null;

comment on column public.org_ingest_senders.confirm_token_sha256 is
  'sha256 of the single-use sender-confirmation token (F4). NULL once the address is confirmed. The raw token lives only in the emailed link.';
comment on column public.org_ingest_senders.confirm_sent_at is
  'When the F4 confirmation email was last sent; drives the 72h link expiry and the resend throttle.';
