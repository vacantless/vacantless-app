-- ============================================================================
-- 0227_inbound_portal_events (S697c)
--
-- One row per rental-site email the lead ingest handled for an org, so the
-- landlord can SEE whether their forwarding rule works without asking us:
-- "Kijiji: working, last inquiry 2 days ago" or "an email came in we could not
-- read". Also holds the one code Gmail emails to a new forwarding address, so a
-- Gmail landlord can finish setup alone.
--
-- No renter data lands here. source + outcome + received_at, and `detail` only
-- ever carries Gmail's numeric confirmation code (CHECK-enforced digits).
-- Written by the webhook with the service role; read by org members.
-- Additive, inert until the ingest writes. Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.inbound_portal_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  source           text not null
                     check (source in ('rentals_ca', 'kijiji', 'gmail_forwarding')),
  outcome          text not null
                     check (outcome in (
                       'lead_created', 'duplicate', 'not_parsed',
                       'auth_unverified', 'cross_org_refused', 'confirmation_code'
                     )),
  detail           text
                     check (detail is null or detail ~ '^[0-9]{6,12}$'),
  received_at      timestamptz not null default now()
);

create index if not exists inbound_portal_events_org_recent_idx
  on public.inbound_portal_events (organization_id, received_at desc);

alter table public.inbound_portal_events enable row level security;

drop policy if exists inbound_portal_events_select_org on public.inbound_portal_events;
create policy inbound_portal_events_select_org
  on public.inbound_portal_events
  for select
  to authenticated
  using (organization_id in (select public.user_org_ids()));

-- Members read; only the webhook (service role) writes.
revoke all on public.inbound_portal_events from anon, authenticated;
grant select on public.inbound_portal_events to authenticated;
grant select, insert, delete on public.inbound_portal_events to service_role;

comment on table public.inbound_portal_events is
  'S697c. What the lead ingest did with each rental-site email, per org. Drives the "Get your inquiries in Vacantless" card. No renter data.';
