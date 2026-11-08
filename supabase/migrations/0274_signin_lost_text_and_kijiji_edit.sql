-- S762: text a Growth landlord when Kijiji, Zumper or Rentals.ca signs them out
-- (REVIEW-S761 item 3). The landlord's own mobile, saved by them in Settings
-- (opt-in), and a once-per-sign-out stamp beside the email's lost_notified_at.
alter table public.organizations
  add column if not exists alert_mobile_e164 text;

alter table public.distribution_channel_sessions
  add column if not exists lost_texted_at timestamptz;

comment on column public.organizations.alert_mobile_e164 is
  'S762: landlord''s own mobile (E.164) for account alerts by text, set by the landlord in Settings. Null = no texts.';
comment on column public.distribution_channel_sessions.lost_texted_at is
  'S762: when the signed-out text went to alert_mobile_e164; cleared once the session works again.';

-- S762: Kijiji edits in place (vacantless-worker src/edit-sites.ts). An "edit"
-- run item is upkeep on an ad already up, like a takedown, never a new post.
alter table public.distribution_run_items
  drop constraint if exists distribution_run_items_transport_check;

alter table public.distribution_run_items
  add constraint distribution_run_items_transport_check
  check (
    transport is null or transport in (
      'automatic',
      'feed_partner',
      'browser_copilot',
      'concierge',
      'broker',
      'custom',
      'takedown',
      'edit'
    )
  );
