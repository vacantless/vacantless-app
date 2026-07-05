-- ============================================================================
-- 0106_distribution_partner_accounts — feed-partner onboarding (S412 Slice 3)
--
-- The Distribute feed note (Slice 1) says a listing "can" be carried by a feed
-- once a partner route exists. This adds the ORG-LEVEL record of that route: for
-- a partner-capable channel (Rentals.ca / Zumper / Viewit / Realtor.ca / a
-- custom Other partner), where the org is in the onboarding process, the feed
-- URL / variant it submitted, who to contact, and the key dates. One account per
-- (org, channel). Facebook + Kijiji are assisted-manual only (no feed/partner
-- route) so they are intentionally NOT valid channels here.
--
-- This is org-level config (like notification_settings), edited from the
-- feed-eligible channel cards on any listing's Distribute tab. Additive + inert;
-- ships with zero rows until an operator records a partner.
--
-- Conventions mirror listing_posts (0014): org-scoped RLS on user_org_ids(),
-- explicit grants (auto-expose off), cascade with the org.
-- ============================================================================

create table if not exists public.distribution_partner_accounts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  channel          text not null
                     check (channel in (
                       'rentals_ca', 'zumper', 'viewit', 'realtor_ca', 'other'
                     )),
  status           text not null default 'not_started'
                     check (status in (
                       'not_started', 'submitted', 'accepted', 'rejected', 'paused'
                     )),
  feed_url         text,
  partner_contact  text,
  submitted_on     date,
  accepted_on      date,
  last_checked_on  date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, channel)
);

create index if not exists idx_distribution_partner_accounts_org
  on public.distribution_partner_accounts(organization_id);

alter table public.distribution_partner_accounts enable row level security;
drop policy if exists distribution_partner_accounts_all on public.distribution_partner_accounts;
create policy distribution_partner_accounts_all on public.distribution_partner_accounts
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));
grant select, insert, update, delete
  on public.distribution_partner_accounts to authenticated;
