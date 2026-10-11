-- ============================================================================
-- 0236_site_signin_windows (S705)
--
-- "Sign in once" for robot-posted sites (Kijiji, Zumper). A landlord asks for a
-- sign-in window; the worker (GitHub Actions) opens a real Chromium, shares
-- its screen through a short-lived private link, the landlord signs in by
-- hand, and the worker saves the encrypted session (distribution_channel_
-- sessions) and closes everything. One row per window. Nothing secret here:
-- the session itself never touches this table.
--
-- status: starting -> ready -> saving -> done
--                     \-> failed | expired | cancelled
-- confirm_requested_at: the landlord pressed "I'm signed in" in the app; the
-- worker checks right away instead of waiting for its own signal.
-- Writes: service role only (the app's server action, and the worker).
-- Reads: members of the org, for the page that shows the window.
-- Idempotent.
-- ============================================================================

create table if not exists public.site_signin_windows (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  channel               text not null check (channel in ('kijiji', 'zumper')),
  requested_by          uuid references auth.users(id) on delete set null,
  status                text not null default 'starting'
                          check (status in ('starting', 'ready', 'saving', 'done', 'failed', 'expired', 'cancelled')),
  view_url              text,
  detail                text,
  confirm_requested_at  timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  expires_at            timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists site_signin_windows_org_recent_idx
  on public.site_signin_windows (organization_id, channel, created_at desc);

alter table public.site_signin_windows enable row level security;

drop policy if exists site_signin_windows_select_org on public.site_signin_windows;
create policy site_signin_windows_select_org
  on public.site_signin_windows
  for select to authenticated
  using (organization_id in (select public.user_org_ids()));

revoke all on public.site_signin_windows from anon;
grant select on public.site_signin_windows to authenticated;
grant select, insert, update on public.site_signin_windows to service_role;
