-- ============================================================================
-- 0249_site_signin_rentals_ca (S717)
--
-- "Sign in once" now covers Rentals.ca. Its window opens on the home runner
-- (a computer with a home connection), because Rentals.ca's Cloudflare blocks
-- GitHub. Only the allowed channel list changes. Idempotent.
-- ============================================================================

alter table public.site_signin_windows
  drop constraint if exists site_signin_windows_channel_check;
alter table public.site_signin_windows
  add constraint site_signin_windows_channel_check
  check (channel in ('kijiji', 'zumper', 'rentals_ca'));
