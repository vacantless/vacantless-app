-- 0068_dispatch_context_photos — surface the tenant's incident photos on the
-- trade's job page (the "dispatch brief" gap S328 dogfood surfaced: a trade
-- cannot honestly accept/quote a job with no description and no picture).
--
-- No schema change. A work order that was approved from a tenant incident report
-- is already linked the other way (incident_reports.converted_work_order_id), and
-- the tenant's photos already live in the private incident-media bucket
-- (migration 0060). This CREATE OR REPLACE just teaches get_dispatch_context to
-- ALSO return the image storage paths for that linked report, so the /job page
-- can mint short-lived signed URLs (via the service-role admin client, exactly
-- like the operator dashboard does) and render the gallery. Paths only here — the
-- function never mints URLs (it's STABLE/anon-callable; the seam stays one edit).
--
-- Authorization is unchanged: the token re-derives the dispatch -> work order,
-- and we only return media for reports that converted INTO that work order, so a
-- token can never reach another job's photos (feedback_anon_rpc_revalidate_*).
-- Image kind only — video is heavier and not needed for an accept/quote decision.
-- ---------------------------------------------------------------------------
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

  -- expired link: return only org branding so the page can render a friendly
  -- terminal message (no job detail leaks past expiry).
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

  -- the address to send the trade to: the unit's address, else the building key.
  if v_wo.property_id is not null then
    select p.address into v_address from public.properties p where p.id = v_wo.property_id;
  else
    v_address := v_wo.building_key;
  end if;

  -- the tenant's photos, if this job came from an incident report. Paths only;
  -- the page signs them. Image kind only, oldest first (the order they were
  -- taken). '[]' when there's no linked report or no photos.
  select coalesce(
           jsonb_agg(jsonb_build_object('path', im.storage_path) order by im.created_at),
           '[]'::jsonb
         )
    into v_photos
  from public.incident_reports ir
  join public.incident_media im on im.incident_report_id = ir.id
  where ir.converted_work_order_id = v_wo.id
    and im.kind = 'image';

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
