-- ============================================================================
-- 0067_notification_settings — per-org, per-event customizable notifications
-- (Option B incident-dispatch, Slice 6 substrate + the Agile→Vacantless
--  teardown foundation).
--
-- WHY THIS EXISTS. Slice 6 ("multi-party scheduling + transition
-- notifications") needs the tenant, the trade, and the operator all kept in the
-- loop as a dispatch moves. Noam's added requirement (S327): the COPY and the
-- RECIPIENTS of every such notification must be operator-editable — because at
-- the Agile→Vacantless teardown, Vacantless has to reproduce the leasing
-- notifications Aaliyah/Agile get today (the daily "Leasing snapshot" digest,
-- the real-time "NEW LEAD — ACTION REQUIRED" alert, the Calendly booking email)
-- so the operator sees NO difference. Rather than hard-code each email, this is
-- a single per-org registry every notification draws from.
--
-- MODEL. ABSENCE of a row == sensible code defaults (the event is ON, the copy
-- is the built-in template in lib/notifications.ts, the recipients are derived
-- from the event's audience). A row is an OVERRIDE: it can disable the event,
-- swap the subject/body template (token-substituted at send), and/or set an
-- explicit recipient list. This means new orgs behave correctly with zero seed
-- rows, and an operator only ever touches the events they want to change.
--
-- AUDIENCE vs RECIPIENTS. Each event has a code-defined audience
-- (operator | trade | tenant — see lib/notifications.ts). For trade/tenant
-- events the natural party (the dispatch's trade-email snapshot, or the
-- tenancy's primary tenant) is ALWAYS a recipient; `recipients` here is an
-- additive cc list. For operator events `recipients` IS the list (falling back
-- in code to org members with the right capability if left empty), which is how
-- Agile reproduces "rentals@agileonline.ca + peterszummer@gmail.com" on the
-- new-lead alert. Channel is email-only for now (the column + CHECK leave room
-- for SMS, the same way 0064 did).
--
-- No new function -> NO new advisor class. Per-org RLS gates operators on
-- organization_id in (select public.user_org_ids()); service_role gets DML so
-- the anon-triggered trade-side sends (which run under the service-role admin
-- client, exactly like the new-report notify in Slice 4) can READ an org's
-- settings without tripping the silent permission-denied trap.
-- Conventions mirror 0054 / 0061 / 0064.
-- ============================================================================

create table if not exists public.notification_settings (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,

  -- the event this row configures, e.g. 'dispatch.scheduled.tenant'. The full
  -- set of valid keys lives in lib/notifications.ts (NOTIFICATION_EVENTS); kept
  -- as free text (not an enum) so adding an event later is a code-only change.
  event_key         text not null,

  -- master on/off for this event for this org. Off == never send.
  enabled           boolean not null default true,

  -- delivery channel. email-only v1; CHECK leaves room for sms (gated on the
  -- `sms`/`renter_sms` entitlement when wired) without another migration.
  channel           text not null default 'email'
                      check (channel in ('email')),

  -- null == use the built-in default template for this event. Stored verbatim;
  -- tokens like {property_address} are substituted at send time. Body is treated
  -- as plain text and wrapped in the branded shell (so an operator can't break
  -- the layout); the Brevo plain-text-fallback link rule still applies.
  subject_template  text,
  body_template     text,

  -- explicit editable recipients (additive cc for trade/tenant events; the
  -- primary list for operator events). Plain email addresses; validated in code.
  recipients        text[] not null default '{}',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- one config row per (org, event).
  unique (organization_id, event_key)
);

create index if not exists notification_settings_org_idx
  on public.notification_settings(organization_id);

alter table public.notification_settings enable row level security;

drop policy if exists notification_settings_all on public.notification_settings;
create policy notification_settings_all on public.notification_settings
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- operator settings UI (RLS-scoped); service_role for the anon-triggered sends
-- that resolve an org's notification config off the request thread.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.notification_settings to authenticated;
grant select, insert, update, delete on public.notification_settings to service_role;
