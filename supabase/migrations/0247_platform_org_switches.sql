-- ============================================================================
-- 0247_platform_org_switches (S717)
--
-- Staff-only, per-organization switches for things a landlord must never turn
-- on for themselves: texting from the shared Vacantless number, and filing
-- emailed-in renters without an instant reply. organization_feature_flags
-- (0199) is NOT safe for these: its RLS lets any org member write their own
-- rows. This table has RLS on, no policies, and is granted to service_role
-- only, so only the server (the staff admin page and the sweeps) can read or
-- write it.
--
-- A switch is on when the org is in the code's built-in list (Agile today) OR
-- has a row here with enabled = true. So applying this changes nothing; it
-- only lets staff add a landlord without a deploy.
-- Idempotent.
-- ============================================================================

create table if not exists public.platform_org_switches (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  switch_key      text not null,
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      text,
  primary key (organization_id, switch_key)
);

do $$
begin
  alter table public.platform_org_switches
    drop constraint if exists platform_org_switches_key_check;
  alter table public.platform_org_switches
    add constraint platform_org_switches_key_check
    check (switch_key in ('shared_sms_number', 'answers_own_enquiries'));
end $$;

alter table public.platform_org_switches enable row level security;

revoke all on public.platform_org_switches from anon, authenticated;
grant select, insert, update, delete on public.platform_org_switches to service_role;

comment on table public.platform_org_switches is
  'Staff-only per-org switches (S717). Service role only; landlords cannot read or write. Read by lib/platform-switches.ts.';
