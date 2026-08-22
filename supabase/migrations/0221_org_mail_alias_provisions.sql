-- ============================================================================
-- S684/S685: Future-customer renter mail alias provisioning state.
--
-- organizations.mail_alias remains the effective, already-safe sender alias. A
-- requested alias must live here until provider forwarding is read back and an
-- explicit activation step sets organizations.mail_alias.
-- ============================================================================

create table if not exists public.org_mail_alias_provisions (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null references public.organizations(id) on delete cascade,
  requested_alias            text not null,
  alias_email                text generated always as (requested_alias || '@vacantless.com') stored,
  status                     text not null default 'requested'
                               check (status in (
                                 'requested',
                                 'reserved',
                                 'provider_pending',
                                 'provider_verified',
                                 'active',
                                 'needs_forward_update',
                                 'failed',
                                 'disabled'
                               )),
  provider                   text not null default 'improvmx'
                               check (provider in ('improvmx')),
  expected_forward_to_email  text,
  expected_ingest_email      text,
  provider_forward_readback  text[],
  requested_by               uuid references auth.users(id) on delete set null,
  requested_at               timestamptz not null default now(),
  provider_verified_at       timestamptz,
  activated_at               timestamptz,
  disabled_at                timestamptz,
  last_checked_at            timestamptz,
  last_error                 text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint org_mail_alias_provisions_alias_chk
    check (requested_alias ~ '^[a-z0-9][a-z0-9-]{1,30}$')
);

create index if not exists org_mail_alias_provisions_org_created_idx
  on public.org_mail_alias_provisions (organization_id, created_at desc);

create index if not exists org_mail_alias_provisions_status_idx
  on public.org_mail_alias_provisions (status);

create unique index if not exists org_mail_alias_provisions_open_alias_uidx
  on public.org_mail_alias_provisions (lower(requested_alias))
  where status <> 'disabled';

comment on table public.org_mail_alias_provisions is
  'S684/S685: request/provider/activation state for future customer renter-facing @vacantless.com aliases. organizations.mail_alias remains the effective sender alias and should be set only after provider forwarding is verified.';

comment on column public.org_mail_alias_provisions.requested_alias is
  'Requested local part, e.g. agile for agile@vacantless.com. Validated like organizations.mail_alias but not live sender state until activated.';

comment on column public.org_mail_alias_provisions.provider_forward_readback is
  'Non-secret provider destination readback, e.g. org reply-to plus <alias>@in.vacantless.com. No credentials or raw messages.';

alter table public.org_mail_alias_provisions enable row level security;

drop policy if exists org_mail_alias_provisions_select_own on public.org_mail_alias_provisions;
create policy org_mail_alias_provisions_select_own on public.org_mail_alias_provisions
  for select to authenticated
  using (organization_id in (select public.user_org_ids()));

revoke all on public.org_mail_alias_provisions from anon;
revoke all on public.org_mail_alias_provisions from authenticated;
revoke all on public.org_mail_alias_provisions from service_role;
grant select on public.org_mail_alias_provisions to authenticated;
grant select, insert, update, delete on public.org_mail_alias_provisions to service_role;
