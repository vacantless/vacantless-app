-- ============================================================================
-- Vacantless - S791a: photographer one-time link (PLAN-S788-UNIT-PROGRESS step 7).
-- ============================================================================
-- When a unit is marked "Photographer booked" (by the landlord or a manager or
-- leasing link), Vacantless makes a link for that one shoot. The photographer
-- (often outside the crew) opens /crew/shoot/<token>, pastes the link to the
-- photos and taps "Photos are in". The link then stops working. It shows one
-- unit's address and shoot date only. A new booking for the unit switches the
-- old link off. Pro photos skip the automatic touch-up.
-- The public page reads and writes only through the service role on the
-- server, re-deriving the org from the token; RLS here is for landlords.
-- Additive.
-- ============================================================================

create table if not exists public.photo_shoot_links (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null references public.organizations(id) on delete cascade,
  property_id                uuid not null references public.properties(id) on delete cascade,
  token                      uuid not null default gen_random_uuid(),
  photographer_name          text check (photographer_name is null or length(photographer_name) between 1 and 120),
  shoot_date                 date,
  created_by_crew_member_id  uuid references public.crew_members(id) on delete set null,
  actor_user_id              uuid,
  expires_at                 timestamptz not null,
  used_at                    timestamptz,
  revoked_at                 timestamptz,
  delivery_url               text check (delivery_url is null or length(delivery_url) <= 1000),
  created_at                 timestamptz not null default now()
);

create unique index if not exists photo_shoot_links_token_key on public.photo_shoot_links (token);
create index if not exists photo_shoot_links_property_idx on public.photo_shoot_links (property_id, created_at desc);
create index if not exists photo_shoot_links_org_idx on public.photo_shoot_links (organization_id, created_at desc);

alter table public.photo_shoot_links enable row level security;

drop policy if exists photo_shoot_links_select_own on public.photo_shoot_links;
create policy photo_shoot_links_select_own on public.photo_shoot_links
  for select to authenticated
  using (organization_id in (select public.user_org_ids()));

drop policy if exists photo_shoot_links_insert_own on public.photo_shoot_links;
create policy photo_shoot_links_insert_own on public.photo_shoot_links
  for insert to authenticated
  with check (
    organization_id in (select public.user_org_ids())
    and exists (
      select 1 from public.properties p
      where p.id = photo_shoot_links.property_id
        and p.organization_id = photo_shoot_links.organization_id
    )
  );

drop policy if exists photo_shoot_links_update_own on public.photo_shoot_links;
create policy photo_shoot_links_update_own on public.photo_shoot_links
  for update to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update on public.photo_shoot_links to authenticated;
grant select, insert, update, delete on public.photo_shoot_links to service_role;
