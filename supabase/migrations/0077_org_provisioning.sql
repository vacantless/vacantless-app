-- 0077_org_provisioning.sql
-- The account-provisioning primitive (S354): provision a NEW org + owner_admin
-- user, exposed two ways (operator-initiated onboarding now; landlord-initiated
-- referral in a later slice). Companion to lib/provisioning(-server).ts.
--
-- Two pieces:
--   1. provision_organization_for_user(p_user_id, p_name, p_slug)
--      A sibling of create_organization (0001) that makes the org + owner_admin
--      membership for an EXPLICIT user id instead of auth.uid(). Used by the
--      service-role provisioning path to stand up a brand-new landlord's own org
--      (one-org-per-user: each landlord gets their OWN org + login, never under
--      another org). SECURITY DEFINER, but GRANTed to service_role ONLY — no
--      authenticated/anon caller can mint an org for an arbitrary user id.
--   2. org_invites: audit + idempotency + referral-attribution record. Stores
--      the LANDLORD (customer) email/name only — never any tenant PII.
--      RLS lets a referrer read/insert their OWN org's referral rows (the
--      forward-looking Slice-2 "refer a landlord" surface); all privileged
--      writes (provision/approve/revoke) go through the service-role client,
--      which bypasses RLS. Table GRANTs are explicit (RLS alone silently
--      no-ops without the table grant — the 0025 lesson).

-- ---------------------------------------------------------------------------
-- 1) provision_organization_for_user
-- ---------------------------------------------------------------------------
create or replace function public.provision_organization_for_user(
  p_user_id uuid,
  p_name    text,
  p_slug    text
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations;
begin
  if p_user_id is null then
    raise exception 'user id required';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'org name required';
  end if;

  insert into public.organizations (name, slug)
  values (p_name, p_slug)
  returning * into v_org;

  insert into public.memberships (organization_id, user_id, role)
  values (v_org.id, p_user_id, 'owner_admin');

  return v_org;
end;
$$;

-- Lock the function down to the service-role caller only. It can stand up an org
-- for ANY user id, so it must never be reachable from an ordinary session.
revoke all on function public.provision_organization_for_user(uuid, text, text) from public;
revoke all on function public.provision_organization_for_user(uuid, text, text) from anon;
revoke all on function public.provision_organization_for_user(uuid, text, text) from authenticated;
grant execute on function public.provision_organization_for_user(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2) org_invites
-- ---------------------------------------------------------------------------
create table if not exists public.org_invites (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  -- the LANDLORD (our customer). No tenant PII ever lands here.
  invited_email       text not null,
  invited_name        text,
  status              text not null default 'pending'
                        check (status in ('pending', 'provisioned', 'accepted', 'revoked', 'failed')),
  source              text not null
                        check (source in ('operator', 'referral')),
  -- referral attribution (null for operator-initiated)
  referred_by_org_id  uuid references public.organizations(id) on delete set null,
  referred_by_user_id uuid references auth.users(id) on delete set null,
  -- set once the primitive provisions the account
  provisioned_org_id  uuid references public.organizations(id) on delete set null,
  provisioned_user_id uuid references auth.users(id) on delete set null,
  -- 192-bit app-generated handle (same pattern as the share/signing tokens);
  -- supplied by the app, never defaulted in SQL (avoids a pgcrypto dependency).
  token               text not null unique,
  provisioned_at      timestamptz,
  accepted_at         timestamptz,
  revoked_at          timestamptz,
  notes               text
);

-- One live provisioned account per email (idempotency safety net). Partial so a
-- pending/revoked/failed row for the same email never blocks a retry.
create unique index if not exists org_invites_provisioned_email_uniq
  on public.org_invites (lower(invited_email))
  where status = 'provisioned';

create index if not exists org_invites_referred_by_org_idx
  on public.org_invites (referred_by_org_id);
create index if not exists org_invites_status_idx
  on public.org_invites (status);

alter table public.org_invites enable row level security;

-- A referrer can READ the referral rows attributed to their own org (the
-- Slice-2 "your referrals" view). Operator-console reads go through the
-- service-role client, which bypasses RLS, so no operator policy is needed.
drop policy if exists org_invites_select_own on public.org_invites;
create policy org_invites_select_own on public.org_invites
  for select to authenticated
  using (referred_by_org_id in (select public.user_org_ids()));

-- A referrer can INSERT only a PENDING referral for their OWN org, attributed to
-- themselves, with no provisioned fields pre-set. This mirrors (and hard-limits)
-- what the Slice-2 client form can do; the elevated provisioning happens later
-- via the service-role path (the re-validate-server-side rule, enforced in SQL).
drop policy if exists org_invites_insert_referral on public.org_invites;
create policy org_invites_insert_referral on public.org_invites
  for insert to authenticated
  with check (
    source = 'referral'
    and status = 'pending'
    and referred_by_org_id in (select public.user_org_ids())
    and referred_by_user_id = auth.uid()
    and provisioned_org_id is null
    and provisioned_user_id is null
  );

grant select, insert on public.org_invites to authenticated;
grant all on public.org_invites to service_role;
