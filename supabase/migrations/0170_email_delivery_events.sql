-- 0170_email_delivery_events.sql
-- Append-only Brevo transactional delivery truth for renter-facing email.
--
-- The webhook writes with the service role. Operators can read their org's
-- events; anon/authenticated clients cannot insert/update/delete delivery rows.

create table if not exists public.email_delivery_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id      text,
  email           text not null,
  kind            text,
  showing_id      uuid references public.showings(id) on delete set null,
  lead_id         uuid references public.leads(id) on delete set null,
  event           text not null
                    check (event in ('delivered', 'bounced', 'blocked', 'spam', 'opened', 'other')),
  reason          text,
  occurred_at     timestamptz not null,
  created_at      timestamptz not null default now()
);

create index if not exists email_delivery_events_org_showing_idx
  on public.email_delivery_events(organization_id, showing_id);

create index if not exists email_delivery_events_org_lead_idx
  on public.email_delivery_events(organization_id, lead_id);

create index if not exists email_delivery_events_email_idx
  on public.email_delivery_events(email);

create index if not exists email_delivery_events_message_id_idx
  on public.email_delivery_events(message_id);

alter table public.email_delivery_events enable row level security;

drop policy if exists email_delivery_events_select on public.email_delivery_events;
create policy email_delivery_events_select on public.email_delivery_events
  for select
  using (organization_id in (select public.user_org_ids()));

revoke all on public.email_delivery_events from anon;
revoke all on public.email_delivery_events from authenticated;

grant select on public.email_delivery_events to authenticated;
grant select, insert, update, delete on public.email_delivery_events to service_role;
