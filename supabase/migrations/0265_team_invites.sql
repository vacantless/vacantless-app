-- 0265_team_invites.sql (S744, roadmap item 14)
-- An owner adds a teammate to their account without sharing a password.
--
-- One row per invite. The emailed link carries a random token; only its
-- SHA-256 is stored, so a database read never yields a working link. Accepting
-- requires the signed-in user's CONFIRMED email to equal invited_email; the
-- token is only a pointer to the row.
--
-- Server-only: every read and write goes through server actions that check
-- the caller's role first and then use the service-role client. RLS is on with
-- no policies, so the anon and authenticated roles see nothing.
create table if not exists public.team_invites (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  invited_email     text not null,
  role              text not null default 'operator'
                    check (role in ('operator', 'showing_helper')),
  token_hash        text not null unique,
  status            text not null default 'pending'
                    check (status in ('pending', 'accepted', 'revoked')),
  invited_by        uuid references auth.users(id) on delete set null,
  accepted_user_id  uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '14 days'),
  accepted_at       timestamptz,
  revoked_at        timestamptz
);

create index if not exists idx_team_invites_org on public.team_invites (organization_id);
create index if not exists idx_team_invites_email on public.team_invites (lower(invited_email));

-- One open invite per email per account (a resend replaces the old one).
create unique index if not exists team_invites_one_pending
  on public.team_invites (organization_id, lower(invited_email))
  where status = 'pending';

alter table public.team_invites enable row level security;

revoke all on public.team_invites from anon, authenticated;
grant select, insert, update, delete on public.team_invites to service_role;
