-- ============================================================================
-- 0203_scheduled_tenant_messages - operator-composed tenant message outbox
--
-- This is separate from 0075 pending_tenant_messages. 0075 is the approval
-- queue for trigger-drafted messages. This table stores messages an operator
-- already wrote, either for a future scheduled send or for the short undo
-- window before dispatch.
-- ============================================================================

create table if not exists public.scheduled_tenant_messages (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  tenancy_id         uuid not null references public.tenancies(id) on delete cascade,
  channel            text not null check (channel in ('email', 'sms', 'both')),
  subject            text,
  body               text not null,
  recipient_ids      uuid[] not null,
  scheduled_send_at  timestamptz not null,
  status             text not null default 'scheduled'
                       check (status in ('scheduled', 'sending', 'sent', 'canceled', 'failed')),
  origin             text not null default 'scheduled'
                       check (origin in ('scheduled', 'undo')),
  created_by         uuid references auth.users(id) on delete set null,
  sent_message_id    uuid references public.tenant_messages(id) on delete set null,
  attempts           int not null default 0,
  error              text,
  created_at         timestamptz not null default now(),
  canceled_at        timestamptz,
  dispatched_at      timestamptz
);

create index if not exists scheduled_tenant_messages_dispatch_idx
  on public.scheduled_tenant_messages(scheduled_send_at)
  where status in ('scheduled', 'sending');

create index if not exists scheduled_tenant_messages_tenancy_idx
  on public.scheduled_tenant_messages(organization_id, tenancy_id, created_at desc);

alter table public.scheduled_tenant_messages enable row level security;

drop policy if exists scheduled_tenant_messages_select on public.scheduled_tenant_messages;
create policy scheduled_tenant_messages_select on public.scheduled_tenant_messages
  for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists scheduled_tenant_messages_insert on public.scheduled_tenant_messages;
create policy scheduled_tenant_messages_insert on public.scheduled_tenant_messages
  for insert
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists scheduled_tenant_messages_update on public.scheduled_tenant_messages;
create policy scheduled_tenant_messages_update on public.scheduled_tenant_messages
  for update
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update on public.scheduled_tenant_messages to authenticated;
grant select, insert, update, delete on public.scheduled_tenant_messages to service_role;
