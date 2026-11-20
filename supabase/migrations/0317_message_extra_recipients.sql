-- 0317_message_extra_recipients.sql
-- S824j: "Also send to" on Every message we send, for the alerts that went
-- only to account owners and admins (where your ads are live, a site signed
-- you out, rental-site account emails, a tenant's report). The owners still
-- get them; these addresses are added. Members of the account read and write
-- their own rows; the senders read with the service role.
-- Rule 431: grants for the new table are in this file, service_role included.

create table if not exists public.message_extra_recipients (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id      text not null
                    check (message_id in ('you-posted-results', 'you-signin-lost', 'you-site-mail', 'you-incident-report')),
  emails          text[] not null default '{}'
                    check (coalesce(array_length(emails, 1), 0) <= 20),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, message_id)
);

alter table public.message_extra_recipients enable row level security;

drop policy if exists message_extra_recipients_all on public.message_extra_recipients;
create policy message_extra_recipients_all on public.message_extra_recipients
  for all
  using (organization_id in (select user_org_ids()))
  with check (organization_id in (select user_org_ids()));

revoke all on public.message_extra_recipients from anon;
grant select, insert, update, delete on public.message_extra_recipients to authenticated;
grant select, insert, update, delete on public.message_extra_recipients to service_role;
