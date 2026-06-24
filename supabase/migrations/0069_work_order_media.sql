-- 0069_work_order_media — operator-attached photos on a work order (S328).
--
-- The S328 dispatch-brief fix surfaced the tenant's incident photos on the
-- trade's job page. But a job the OPERATOR creates themselves (no tenant report)
-- still had no way to carry a picture — the asymmetry Noam flagged. This adds a
-- per-work-order media table so an operator can attach their own photo(s); the
-- /job page then shows them exactly like the tenant ones.
--
-- Storage: REUSES the private `incident-media` bucket (0060) — no new bucket. The
-- bucket's storage RLS gates writes on the FIRST path segment = org id, so a
-- work-order path `<org_id>/work-orders/<work_order_id>/<media_id>.<ext>` is
-- already covered for an authenticated operator (no storage-policy change). The
-- operator uploads with their own RLS session (they have an account), so the
-- account-less signed-upload dance the tenant flow needs doesn't apply here.
--
-- get_dispatch_context is updated to UNION these into the same `job_photos`
-- array the /job page already renders — so the page needs no change.
-- ---------------------------------------------------------------------------

-- 1. Metadata table (bytes live in the bucket; this row is the pointer). Mirrors
--    incident_media's shape + per-org RLS + explicit grants (auto-expose off).
create table if not exists public.work_order_media (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id   uuid not null references public.work_orders(id) on delete cascade,
  storage_path    text not null,
  mime_type       text not null,
  size_bytes      integer not null check (size_bytes >= 0),
  kind            text not null check (kind in ('image','video')),
  created_at      timestamptz not null default now()
);

create index if not exists work_order_media_wo_idx
  on public.work_order_media(work_order_id);
create index if not exists work_order_media_org_idx
  on public.work_order_media(organization_id);

alter table public.work_order_media enable row level security;

drop policy if exists work_order_media_all on public.work_order_media;
create policy work_order_media_all on public.work_order_media
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.work_order_media to authenticated;
grant select, insert, update, delete on public.work_order_media to service_role;

-- 2. get_dispatch_context — UNION work-order photos into job_photos alongside the
--    tenant incident-report photos. Everything else is unchanged from 0068.
create or replace function public.get_dispatch_context(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dispatch public.work_order_dispatches%rowtype;
  v_wo       public.work_orders%rowtype;
  v_org_name text;
  v_brand    text;
  v_brand2   text;
  v_logo     text;
  v_address  text;
  v_photos   jsonb;
begin
  if p_token is null or btrim(p_token) = '' then
    return null;
  end if;

  select * into v_dispatch
  from public.work_order_dispatches
  where trade_access_token = p_token;
  if v_dispatch.id is null then
    return null;
  end if;

  select o.name, o.brand_color, o.brand_color_secondary, o.logo_url
    into v_org_name, v_brand, v_brand2, v_logo
  from public.organizations o
  where o.id = v_dispatch.organization_id;

  if v_dispatch.token_expires_at <= now() then
    return jsonb_build_object(
      'expired',   true,
      'org_name',  v_org_name,
      'brand_color', v_brand,
      'brand_color_secondary', v_brand2,
      'logo_url',  v_logo
    );
  end if;

  select * into v_wo from public.work_orders where id = v_dispatch.work_order_id;

  if v_wo.property_id is not null then
    select p.address into v_address from public.properties p where p.id = v_wo.property_id;
  else
    v_address := v_wo.building_key;
  end if;

  -- Photos the trade should see: the tenant's incident photos (if this job came
  -- from a report) PLUS any photos the operator attached to the work order. Image
  -- kind only, oldest first. Paths only; the page mints the signed URLs.
  select coalesce(
           jsonb_agg(jsonb_build_object('path', p.storage_path) order by p.created_at),
           '[]'::jsonb
         )
    into v_photos
  from (
    select im.storage_path, im.created_at
    from public.incident_reports ir
    join public.incident_media im on im.incident_report_id = ir.id
    where ir.converted_work_order_id = v_wo.id
      and im.kind = 'image'
    union all
    select wm.storage_path, wm.created_at
    from public.work_order_media wm
    where wm.work_order_id = v_wo.id
      and wm.kind = 'image'
  ) p;

  return jsonb_build_object(
    'expired',          false,
    'token',            v_dispatch.trade_access_token,
    'dispatch_status',  v_dispatch.dispatch_status,
    'trade_name',       v_dispatch.trade_name_snapshot,
    'operator_note',    v_dispatch.operator_note,
    'decline_reason',   v_dispatch.decline_reason,
    'quote_cents',      v_dispatch.quote_cents,
    'quote_note',       v_dispatch.quote_note,
    'proposed_date',    v_dispatch.proposed_date,
    'scheduled_for',    v_dispatch.scheduled_for,
    'job_title',        v_wo.title,
    'job_description',  v_wo.description,
    'job_category',     v_wo.category,
    'job_priority',     v_wo.priority,
    'job_photos',       coalesce(v_photos, '[]'::jsonb),
    'property_address', v_address,
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'brand_color_secondary', v_brand2,
    'logo_url',         v_logo
  );
end;
$$;

grant execute on function public.get_dispatch_context(text) to anon, authenticated;
