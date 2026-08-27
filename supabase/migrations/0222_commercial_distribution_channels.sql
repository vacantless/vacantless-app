-- ============================================================================
-- 0222_commercial_distribution_channels
--
-- Source migration for S303 commercial channel candidates. This only expands the
-- same text check constraints that back the app's source channel taxonomy. Apply
-- in a separate DB gate before deploying UI that allows persisted SpaceList or
-- CoStar/LoopNet run items.
-- ============================================================================

alter table public.listing_posts
  drop constraint if exists listing_posts_portal_check;
alter table public.listing_posts
  add constraint listing_posts_portal_check
  check (portal in (
    'kijiji', 'facebook', 'linkedin', 'instagram', 'facebook_feed',
    'whatsapp', 'snapchat', 'rentals_ca', 'rentfaster', 'zumper',
    'viewit', 'spacelist', 'costar_loopnet', 'realtor_ca', 'other'
  ));

alter table public.distribution_run_items
  drop constraint if exists distribution_run_items_channel_check;
alter table public.distribution_run_items
  add constraint distribution_run_items_channel_check
  check (channel in (
    'vacantless',
    'org_feed',
    'network_feed',
    'kijiji',
    'facebook',
    'linkedin',
    'instagram',
    'facebook_feed',
    'whatsapp',
    'snapchat',
    'rentals_ca',
    'rentfaster',
    'zumper',
    'viewit',
    'spacelist',
    'costar_loopnet',
    'realtor_ca',
    'other'
  ));

alter table public.distribution_channel_accounts
  drop constraint if exists distribution_channel_accounts_channel_check;
alter table public.distribution_channel_accounts
  add constraint distribution_channel_accounts_channel_check
  check (channel in (
    'vacantless',
    'org_feed',
    'network_feed',
    'facebook',
    'kijiji',
    'linkedin',
    'instagram',
    'facebook_feed',
    'whatsapp',
    'snapchat',
    'rentals_ca',
    'rentfaster',
    'zumper',
    'viewit',
    'spacelist',
    'costar_loopnet',
    'realtor_ca',
    'other'
  ));
