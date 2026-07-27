-- ============================================================================
-- Vacantless — Tier 1 C: landlord feature-reveal campaign (comp-as-lead-in)
-- ============================================================================
-- A landlord-facing analog of the renter nurture drip (0012_m5_nurture_drip):
-- a gentle, paced sequence that reveals one paid capability at a time to a
-- FREE-plan org that has at least one tenancy, and routes them to upgrade. A
-- background sweep (app/api/cron/landlord-campaign) sends only the NEXT due
-- reveal and bumps landlord_campaign_step_sent, so a re-run never double-sends.
-- The whole surface ships dark behind LANDLORD_CAMPAIGN_ENABLED.
--
-- Shape mirrors the nurture drip exactly: a per-org watermark + last-sent stamp
-- + a master opt-out. All columns land on organizations, whose M1 grants are
-- table-level with no column list, so they extend to columns added later; the
-- sweep reads/writes via the service-role client, so NO new grant or RPC is
-- needed (same as 0012).
--
--   * organizations.landlord_campaign_step_sent   — NEW int (default 0). How
--     many reveals this org has received; the sweep only ever sends the next
--     one, so the count is the idempotency watermark.
--   * organizations.landlord_campaign_last_sent_at — NEW nullable timestamptz.
--     When the last reveal went out; paces a catch-up sweep (MIN_GAP_HOURS).
--   * organizations.landlord_campaign_opted_out    — NEW bool (default false).
--     Per-org master off switch (an unsubscribe / operator toggle).
--
-- Additive + idempotent. M1 base-table RLS untouched.
-- ============================================================================

alter table public.organizations
  add column if not exists landlord_campaign_step_sent integer not null default 0;

alter table public.organizations
  add column if not exists landlord_campaign_last_sent_at timestamptz;

alter table public.organizations
  add column if not exists landlord_campaign_opted_out boolean not null default false;

-- Sweep target: free-plan orgs that have not opted out and are not fully through
-- the sequence. The cadence/eligibility decision is made in code
-- (lib/landlord-campaign.ts); this partial index just keeps the scan cheap.
create index if not exists idx_orgs_landlord_campaign_pending
  on public.organizations (created_at)
  where landlord_campaign_opted_out = false
    and landlord_campaign_step_sent < 5
    and plan = 'free';
