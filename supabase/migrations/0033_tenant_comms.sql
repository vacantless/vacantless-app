-- ============================================================================
-- 0033_tenant_comms — landlord -> tenant communications (platform pivot step 3)
--
-- Step 1 (0028) gave us the tenant/tenancy record; step 2 (0029-0032) the rent
-- rail. Step 3 is communications: let a landlord message the tenants on a
-- tenancy (rent reminders, maintenance notices, general updates) by EMAIL and/or
-- SMS, reusing the existing Brevo (lib/email.ts) + Twilio (lib/sms.ts) rails.
--
-- Identity model is the one already proven for renter mail: everything goes out
-- under the one domain-authed sender, the per-org brand rides in the display
-- name + reply-to (NOT a spoofed FROM — the DMARC lesson). No new sender infra.
--
-- Three tables + one column:
--
--   tenant_message_templates — per-org REUSABLE saved templates (the "saved
--     templates" half of the scope). channel says where it can be used; subject
--     is email-only (nullable for sms-only); body is the message text with
--     {{token}} placeholders the app substitutes per recipient.
--
--   tenant_messages — the SEND LOG parent: one row per send action against a
--     tenancy. Stores the channel + the rendered-but-untokenized subject/body
--     the operator authored, plus denormalized counts so the history list need
--     not join the child rows. sent_by = the acting member (audit trail).
--
--   tenant_message_deliveries — per-recipient child: one row per (tenant x
--     channel) attempt with the destination it went to and the outcome
--     (sent / failed / skipped) + a reason. Mirrors the tenancies/tenants
--     parent-child shape (0028); organization_id denormalized so RLS gates
--     without a join.
--
--   tenants.sms_opt_out — a tenant-level opt-out flag (default false). Honored
--     before any tenant SMS send so we never text an opted-out tenant; the
--     SMS body always carries "Reply STOP to opt out". (Inbound STOP wiring for
--     tenants — flipping this from the Twilio webhook — is a follow-up; the
--     column + send-skip is the minimal compliance hook now.)
--
-- channel whitelists use a CHECK (not a pg enum) so extending later is a
-- one-line change (the 0032 lesson). Conventions mirror 0028/0032: RLS gates on
-- organization_id in (select public.user_org_ids()); explicit grants because
-- auto-expose of new tables is OFF; service_role gets DML too (future
-- send-status callback / digest cron won't hit the silent permission-denied
-- trap — the 0007 lesson).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- tenant_message_templates — reusable, org-level
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_message_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  name            text not null,
  -- where this template is meant to be used. 'both' = email + sms.
  channel         text not null default 'email'
                    check (channel in ('email', 'sms', 'both')),
  -- email-only; null for sms-only templates.
  subject         text,
  body            text not null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists tenant_message_templates_org_idx
  on public.tenant_message_templates(organization_id);

-- ---------------------------------------------------------------------------
-- tenant_messages — send-log parent
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenancy_id      uuid not null references public.tenancies(id)     on delete cascade,

  channel         text not null
                    check (channel in ('email', 'sms', 'both')),
  -- the operator-authored content (pre-token-substitution), kept for history.
  subject         text,
  body            text not null,

  -- denormalized delivery tallies so the history list renders without a join.
  recipient_count integer not null default 0,
  sent_count      integer not null default 0,
  failed_count    integer not null default 0,
  skipped_count   integer not null default 0,

  -- the acting member (auth.users id). Audit trail; null-safe if the user is
  -- later removed (set null rather than cascade — keep the message record).
  sent_by         uuid references auth.users(id) on delete set null,

  created_at      timestamptz not null default now()
);

create index if not exists tenant_messages_org_idx
  on public.tenant_messages(organization_id);
create index if not exists tenant_messages_tenancy_idx
  on public.tenant_messages(tenancy_id, created_at desc);

-- ---------------------------------------------------------------------------
-- tenant_message_deliveries — per-recipient child
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_message_deliveries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id      uuid not null references public.tenant_messages(id) on delete cascade,
  -- the tenant this delivery targeted. set null (not cascade) so the delivery
  -- record survives a tenant being removed from the roster later.
  tenant_id       uuid references public.tenants(id) on delete set null,

  tenant_name     text,
  channel         text not null check (channel in ('email', 'sms')),
  -- the email address / phone number the attempt went to.
  destination     text,
  status          text not null check (status in ('sent', 'failed', 'skipped')),
  -- machine reason (e.g. no_email / opted_out / brevo_4xx / twilio_4xx).
  reason          text,

  created_at      timestamptz not null default now()
);

create index if not exists tenant_message_deliveries_org_idx
  on public.tenant_message_deliveries(organization_id);
create index if not exists tenant_message_deliveries_message_idx
  on public.tenant_message_deliveries(message_id);

-- ---------------------------------------------------------------------------
-- tenants.sms_opt_out — tenant-level SMS opt-out (compliance hook)
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists sms_opt_out boolean not null default false;

-- ---------------------------------------------------------------------------
-- RLS — per-org, same shape as 0028 / 0032.
-- ---------------------------------------------------------------------------
alter table public.tenant_message_templates   enable row level security;
alter table public.tenant_messages            enable row level security;
alter table public.tenant_message_deliveries  enable row level security;

drop policy if exists tenant_message_templates_all on public.tenant_message_templates;
create policy tenant_message_templates_all on public.tenant_message_templates
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists tenant_messages_all on public.tenant_messages;
create policy tenant_messages_all on public.tenant_messages
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

drop policy if exists tenant_message_deliveries_all on public.tenant_message_deliveries;
create policy tenant_message_deliveries_all on public.tenant_message_deliveries
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard; service_role for a future send-status callback / digest cron.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.tenant_message_templates  to authenticated;
grant select, insert, update, delete on public.tenant_message_templates  to service_role;
grant select, insert, update, delete on public.tenant_messages           to authenticated;
grant select, insert, update, delete on public.tenant_messages           to service_role;
grant select, insert, update, delete on public.tenant_message_deliveries to authenticated;
grant select, insert, update, delete on public.tenant_message_deliveries to service_role;
