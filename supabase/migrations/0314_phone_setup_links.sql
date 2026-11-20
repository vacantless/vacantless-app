-- 0314_phone_setup_links.sql
-- S824d: "Set up my phone" on Quick replies. The computer shows a QR code; the
-- phone that scans it opens /phone/<token>, and one tap there signs that phone
-- in and, on iPhone, makes the Send to Vacantless key and copies it. A link
-- works once and for 15 minutes. Only the server (service role) reads or
-- writes this table: no policy for signed-in users, on purpose.
-- Rule 431: grants for the new table are in this file, service_role included.

create table if not exists public.phone_setup_links (
  token           uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '15 minutes'),
  used_at         timestamptz
);

create index if not exists idx_phone_setup_links_user
  on public.phone_setup_links (user_id, created_at desc);

alter table public.phone_setup_links enable row level security;

revoke all on public.phone_setup_links from anon, authenticated;
grant select, insert, update, delete on public.phone_setup_links to service_role;
