-- ============================================================================
-- Vacantless — M5 differentiator: lead nurture drip (inquiry → lease)
-- ============================================================================
-- An automated, gentle follow-up sequence to a renter who inquired but hasn't
-- yet booked a showing. A background sweep emails a small, paced series of
-- branded nudges (default cadence ~2 / ~5 / ~10 days after the inquiry), each
-- linking back to the listing to book a showing. The sequence STOPS the moment
-- the lead advances past the early pipeline (books / shows / applies / leases)
-- or is marked lost — eligibility is keyed to the lead's status, so no extra
-- bookkeeping is needed to halt it.
--
-- Shape: this mirrors the M3 reminder / M5 feedback CRON SWEEPS (operator does
-- nothing; a service-role sweep runs across all orgs), NOT the operator-button
-- price-drop blast. Idempotent + catch-up safe via a per-lead watermark.
--
-- Schema added here (all on already-granted tables — the M1 grants are
-- table-level with no column list, so they extend to columns added later; the
-- sweep reads via the service-role client so no new RPC is needed):
--
--   * leads.nurture_step_sent     — NEW int (default 0). How many nurture
--     emails this lead has received (0..3). The sweep only ever sends the NEXT
--     step, so a re-run never double-sends and the count is the watermark.
--
--   * leads.nurture_last_sent_at  — NEW nullable timestamptz. When the last
--     nurture email went out. Paces a catch-up sweep so two steps can't fire
--     back-to-back for a lead whose thresholds have all already elapsed.
--
--   * organizations.nurture_enabled — NEW bool (default true). Per-org master
--     switch, edited on the Settings page.
--
-- Additive + idempotent. Run once after 0011. M1 base-table RLS untouched.
-- ============================================================================

alter table public.leads
  add column if not exists nurture_step_sent integer not null default 0;

alter table public.leads
  add column if not exists nurture_last_sent_at timestamptz;

alter table public.organizations
  add column if not exists nurture_enabled boolean not null default true;

-- Sweep target: still-open, not-yet-fully-nurtured leads. The cadence/freshness
-- decision is made in code (lib/nurture.ts); this index just keeps the scan
-- cheap as the leads table grows.
create index if not exists idx_leads_nurture_pending
  on public.leads (created_at)
  where nurture_step_sent < 3
    and status in ('new', 'replied', 'contacted');
