-- ============================================================================
-- 0225_distribution_channel_session_status
--
-- Post Everywhere Slice 1 (SCOPE-S687 / SPEC-S688). Gives the connect tiles a
-- non-secret read of each portal session: who it is signed in as, whether it
-- is alive, the free cap, and when the worker last looked. The worker owns
-- every status column; the app only writes check_requested_at (service role).
-- The three secret columns (encrypted_state, iv, auth_tag) are never granted
-- to authenticated, not even through the view.
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.distribution_channel_sessions
  add column if not exists account_label       text,
  add column if not exists alive               boolean,
  add column if not exists cap_used            integer,
  add column if not exists cap_total           integer,
  add column if not exists last_checked_at     timestamptz,
  add column if not exists last_check_code     text,
  add column if not exists last_check_error    text,
  add column if not exists check_requested_at  timestamptz,
  add column if not exists check_requested_by  uuid references auth.users(id) on delete set null;

-- last_check_code is the rule-157 classification of the probe, one word.
-- 'ok'          signed in, manage page read
-- 'needs_login' positive login signal (login form or /login end url) -> alive=false
-- 'cloudflare'  challenge page or __cf_chl in end url -> alive UNCHANGED
-- 'captcha'     non-Cloudflare captcha -> alive UNCHANGED
-- 'no_session'  no row / decrypt failed -> alive=false
-- 'timeout'     navigation or manage page never painted -> alive UNCHANGED
-- 'error'       anything else; last_check_error carries the message
do $$
begin
  alter table public.distribution_channel_sessions
    drop constraint if exists distribution_channel_sessions_last_check_code_check;
  alter table public.distribution_channel_sessions
    add constraint distribution_channel_sessions_last_check_code_check
    check (last_check_code is null or last_check_code in (
      'ok', 'needs_login', 'cloudflare', 'captcha', 'no_session', 'timeout', 'error'
    ));
  alter table public.distribution_channel_sessions
    drop constraint if exists distribution_channel_sessions_cap_check;
  alter table public.distribution_channel_sessions
    add constraint distribution_channel_sessions_cap_check
    check (
      (cap_used is null or cap_used >= 0)
      and (cap_total is null or cap_total >= 0)
    );
end $$;

comment on column public.distribution_channel_sessions.account_label is
  'Display name or email the portal shows for this session. Worker-written. Null when the probe cannot read it; the tile falls back to distribution_channel_accounts.external_account_label.';
comment on column public.distribution_channel_sessions.alive is
  'Null = never probed. False ONLY on a positive login signal or a missing/undecryptable row. A challenge, captcha or timeout leaves it unchanged.';
comment on column public.distribution_channel_sessions.cap_used is
  'Object read of the portal manage list (Rentals.ca: rows reading Active; Zumper: cards reading Live; Kijiji: active ads on My Ads). Never our own row count.';
comment on column public.distribution_channel_sessions.cap_total is
  'Free cap per account as known on the probe date: Rentals.ca 3, Zumper 5, Kijiji 1 (personal tier) or null (business tier: every ad paid).';
comment on column public.distribution_channel_sessions.check_requested_at is
  'App writes now() (service role) when a tile opens stale. Worker probes when check_requested_at > coalesce(last_checked_at, -infinity).';

-- Cheap worker poll: only rows that asked, or were never checked.
create index if not exists idx_distribution_channel_sessions_check_due
  on public.distribution_channel_sessions (organization_id, channel)
  where check_requested_at is not null
     or last_checked_at is null;

-- ---------------------------------------------------------------------------
-- Read path for the app user. Two layers, both required:
--   (a) an org-scoped SELECT policy on the base table (the table had none for
--       authenticated; RLS was service_role only since 0180), and
--   (b) a COLUMN-level grant that lists every non-secret column and omits
--       encrypted_state, iv, auth_tag. A security_invoker view over the table
--       then inherits both. select * on the table as authenticated fails with
--       permission denied for the three secret columns, by design.
-- ---------------------------------------------------------------------------

drop policy if exists distribution_channel_sessions_select_org
  on public.distribution_channel_sessions;
create policy distribution_channel_sessions_select_org
  on public.distribution_channel_sessions
  for select to authenticated
  using (organization_id in (select public.user_org_ids()));

revoke all on public.distribution_channel_sessions from authenticated;
grant select (
  organization_id, channel, expires_at, last_validated_at, updated_at, created_at,
  account_label, alive, cap_used, cap_total,
  last_checked_at, last_check_code, last_check_error, check_requested_at
) on public.distribution_channel_sessions to authenticated;

create or replace view public.distribution_channel_session_status
  with (security_invoker = true)
as
select
  s.organization_id,
  s.channel,
  s.account_label,
  s.alive,
  s.cap_used,
  s.cap_total,
  s.last_checked_at,
  s.last_check_code,
  s.last_check_error,
  s.check_requested_at,
  s.expires_at,
  s.last_validated_at,
  s.updated_at,
  (s.last_checked_at is null
     or s.last_checked_at < now() - interval '24 hours') as stale,
  (s.check_requested_at is not null
     and s.check_requested_at > coalesce(s.last_checked_at, '-infinity'::timestamptz)) as check_pending
from public.distribution_channel_sessions s;

comment on view public.distribution_channel_session_status is
  'Non-secret projection of distribution_channel_sessions for the connect tiles. security_invoker: RLS and the column grant on the base table apply to the caller.';

grant select on public.distribution_channel_session_status to authenticated;
grant select on public.distribution_channel_session_status to service_role;
