-- S816l: "Send to Vacantless" in the iPhone share menu. Each landlord makes a
-- key on Quick replies; the Apple Shortcut sends a chat screenshot with it and
-- the renter is saved. We store sha256(key) only, never the key itself.
create table if not exists public.capture_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  key_hash text not null unique,
  key_hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  window_start timestamptz,
  uses_in_window integer not null default 0,
  revoked_at timestamptz
);

create index if not exists capture_keys_user_idx on public.capture_keys (user_id, organization_id);

alter table public.capture_keys enable row level security;

-- A person sees only their own keys. Writes go through the server.
drop policy if exists capture_keys_select_own on public.capture_keys;
create policy capture_keys_select_own on public.capture_keys
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.capture_keys from anon;
revoke insert, update, delete on public.capture_keys from authenticated;
