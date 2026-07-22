-- ============================================================================
-- 0179_org_notification_lanes — per-org operator notification "lane" routing
-- (S554, Slice 1). The middle tier between a per-event recipient override and
-- the capability-member default.
--
-- WHY THIS EXISTS. Today every OPERATOR leasing notification defaults to the
-- manage_leads capability (the showing lane), and the Noam-vs-Aaliyah split is
-- hand-curated as recipient strings on notification_settings, one event at a
-- time. Two problems fall out: (1) the split is maintained by hand on every
-- event; (2) any NEW operator leasing event silently lands in the showing
-- operator's inbox until someone repoints it (S548b was exactly that bug caught
-- late). This adds a per-org, per-lane recipient list so an org sets who handles
-- each KIND of alert (listing / showing / owner) once, and new events auto-route
-- by their code-declared lane.
--
-- MODEL. ABSENCE of a row == today's behavior exactly. Recipient resolution for
-- an operator event becomes: per-event notification_settings.recipients override
-- (unchanged, still WINS) -> this lane's recipients (NEW middle tier) -> the
-- capability-member default (unchanged final fallback). audienceEmail (assigned
-- agent) + alwaysInclude safety CCs are still forced in first. No backfill: an
-- org with no lane rows resolves byte-identically to before this migration.
--
-- Deploy-safe (KI844): the lane read in lib/notifications-server.ts is guarded
-- independently, so a deploy that lands before this migration no-ops (empty lane
-- recipients) rather than suppressing the notification.
--
-- RLS + grants mirror 0067 (notification_settings): org members manage their own
-- org's rows; service_role gets DML so the crons that send off the request
-- thread can READ lanes without tripping the silent permission-denied trap
-- (the S530 / KI850 grant-gap class).
-- ============================================================================

create table if not exists public.org_notification_lanes (
  organization_id   uuid not null references public.organizations(id) on delete cascade,

  -- which operator lane this row configures. listing = ad / syndication /
  -- distribution health / done-for-you posting; showing = the inquiry-to-lease
  -- funnel (leads, viewings, showings, availability, the daily leasing snapshot);
  -- owner = landlord / property-owner compliance, assets, rent increases (the
  -- N1-serving side). The canonical set lives in lib/notifications.ts
  -- (NotificationLane); the CHECK keeps the table honest.
  lane              text not null check (lane in ('listing','showing','owner')),

  -- who handles this lane. Plain email addresses; validated in code
  -- (validateRecipientsInput). Empty == fall back to the capability default.
  recipients        text[] not null default '{}',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- one recipient list per (org, lane).
  primary key (organization_id, lane)
);

alter table public.org_notification_lanes enable row level security;

drop policy if exists org_notification_lanes_all on public.org_notification_lanes;
create policy org_notification_lanes_all on public.org_notification_lanes
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- Settings lane editor (RLS-scoped); service_role for the crons that resolve an
-- org's lane recipients off the request thread (admin client, bypasses RLS but
-- still needs the table GRANT — the KI850 lesson).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.org_notification_lanes to authenticated;
grant select, insert, update, delete on public.org_notification_lanes to service_role;
