-- ============================================================================
-- 0079_compliance_reminder_log — generic at-most-once log for the LANDLORD-NOTIFY
-- compliance-calendar tier (S357).
--
-- WHY THIS EXISTS. The seasonal SOFT tenant courtesy notes (S343) use the
-- pending_tenant_messages row itself as their idempotency guard (the cron upserts
-- one draft per (org, event, season) on that table's unique index). The new
-- landlord-notify tier is different: it does NOT draft a tenant message — it
-- emails the LANDLORD/operator directly (audience operator, sendMode "notify",
-- exactly like leasing.rent_increase) when an ANNUAL landlord-side compliance
-- item enters its calendar window (review your property insurance; smoke/CO alarm
-- compliance; book the heating-system service). Those reminders are ORG-WIDE (one
-- per org per season, not per-tenancy), so unlike rent-increase there is no
-- per-tenancy stamp (tenancies.rent_increase_nudged_for) to gate them and no
-- pending_tenant_messages row to dedupe on. This table is that missing guard: a
-- small append-only log the 15-min compliance-calendar cron checks before sending
-- and writes after, so a given landlord reminder fires AT MOST ONCE per season.
--
-- IDENTITY MODEL. Rows are pure operator-side data. The CRON (service_role) reads
-- + writes; an authenticated member may READ their own org's log (so a future UI
-- can show "last reminded on …"); there is no member write path (the log is not
-- operator-editable — it only records what the cron actually sent). No anon
-- surface, no token RPC, no new function -> no new advisor class. Conventions
-- mirror 0067 / 0075: per-org RLS via public.user_org_ids(); EXPLICIT grants
-- because auto-expose is OFF; service_role DML so the cron never hits the silent
-- permission-denied trap (feedback_supabase_new_table_needs_table_grant).
-- ============================================================================

create table if not exists public.compliance_reminder_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- which registered notification event was sent (an operator/notify compliance
  -- event in lib/notifications NOTIFICATION_EVENTS, e.g.
  -- 'leasing.landlord_insurance_review'). Text, not an fk — the registry is code,
  -- not a table (mirrors notification_settings.event_key / pending_tenant_messages).
  event_key       text not null,

  -- the per-fire idempotency scope. For the annual landlord items this is the
  -- season anchor ('season:<year>', complianceReminderDedupeKey) — so a reminder
  -- fires once per org per event per year even though the calendar window stays
  -- open for weeks. Kept generic (text) so a future per-property/per-tenancy
  -- landlord reminder can encode its own scope here.
  dedupe_key      text not null,

  -- when the cron recorded the send (best-effort: the email send itself is fire-
  -- and-forget via sendOrgNotification, which never throws).
  sent_at         timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- The idempotency guard: at most one row per (org, event, dedupe_key). NOT
-- partial and all columns NOT NULL, so it is a clean ON CONFLICT target for the
-- cron's upsert (mirrors the pending_tenant_messages dedupe index rationale).
create unique index if not exists compliance_reminder_log_dedupe_idx
  on public.compliance_reminder_log(organization_id, event_key, dedupe_key);

-- Hot read: this org's log, newest-first (a future "last reminded" surface).
create index if not exists compliance_reminder_log_org_idx
  on public.compliance_reminder_log(organization_id, sent_at desc);

alter table public.compliance_reminder_log enable row level security;

-- Operators may READ their own org's log; no member write path (cron-only writes
-- run as service_role and bypass RLS). The explicit grants below are still
-- required so an authenticated read doesn't silently no-op.
drop policy if exists compliance_reminder_log_select_own on public.compliance_reminder_log;
create policy compliance_reminder_log_select_own on public.compliance_reminder_log
  for select
  using (organization_id in (select public.user_org_ids()));

grant select on public.compliance_reminder_log to authenticated;
grant select, insert, update, delete on public.compliance_reminder_log to service_role;
