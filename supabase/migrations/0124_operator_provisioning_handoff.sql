-- 0124_operator_provisioning_handoff.sql
-- S451 operator provisioning handoff:
--   - concierge/proxy-created orgs keep renter-facing contact on the proxy
--   - org_invites stores the intended owner email for a later login handoff
--   - handed_off becomes a first-class terminal invite status
--
-- GLOBAL shared-DB migration. Apply before deploying code that reads/writes
-- these columns.

alter table public.organizations
  add column if not exists concierge boolean not null default false,
  add column if not exists concierge_contact_confirmed_at timestamptz;

alter table public.org_invites
  add column if not exists intended_owner_email text,
  add column if not exists handed_off_at timestamptz,
  add column if not exists handed_off_to_email text;

do $$
declare
  status_constraint text;
begin
  select conname
    into status_constraint
  from pg_constraint
  where conrelid = 'public.org_invites'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%provisioned%'
    and pg_get_constraintdef(oid) like '%accepted%'
  limit 1;

  if status_constraint is not null then
    execute format('alter table public.org_invites drop constraint %I', status_constraint);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.org_invites'::regclass
      and conname = 'org_invites_status_check'
  ) then
    alter table public.org_invites
      add constraint org_invites_status_check
      check (status in ('pending', 'provisioned', 'handed_off', 'accepted', 'revoked', 'failed'));
  end if;
end $$;

drop index if exists public.org_invites_provisioned_email_uniq;

create unique index if not exists org_invites_active_email_uniq
  on public.org_invites (lower(invited_email))
  where invited_email is not null
    and status in ('provisioned', 'handed_off');

comment on column public.organizations.concierge is
  'True while an operator/proxy owns the login and renter-facing contact before landlord handoff.';
comment on column public.organizations.concierge_contact_confirmed_at is
  'Timestamp when the prepared org was handed to the real landlord email.';
comment on column public.org_invites.intended_owner_email is
  'Real landlord email saved during proxy provisioning; becomes the login/public contact at handoff.';
comment on column public.org_invites.handed_off_at is
  'Timestamp when a provisioned proxy account was moved to the intended landlord email.';
comment on column public.org_invites.handed_off_to_email is
  'Email that received the login at handoff.';
