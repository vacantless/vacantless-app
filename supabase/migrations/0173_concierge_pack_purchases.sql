-- 0173_concierge_pack_purchases.sql
-- One-time concierge pack purchases. Dark until CONCIERGE_DESK_ENABLED; rows are
-- inserted only by the Stripe webhook service-role client after a completed pack
-- Checkout session.

create table if not exists public.concierge_pack_purchases (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  period                    text not null, -- 'YYYY-MM' (UTC), the month the pack applies to
  quantity                  integer not null,
  stripe_payment_intent_id  text unique,
  amount_cents              integer,
  created_at                timestamptz not null default now()
);

alter table public.concierge_pack_purchases enable row level security;

drop policy if exists concierge_pack_purchases_read on public.concierge_pack_purchases;
create policy concierge_pack_purchases_read on public.concierge_pack_purchases
  for select using (organization_id in (select public.user_org_ids()));

revoke all on public.concierge_pack_purchases from anon;
revoke all on public.concierge_pack_purchases from authenticated;
grant select on public.concierge_pack_purchases to authenticated;
grant select, insert on public.concierge_pack_purchases to service_role;
