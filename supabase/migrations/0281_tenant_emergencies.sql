-- ============================================================================
-- Vacantless - S776: after-hours tenant emergencies (PLAN-S775 Phase 3).
-- ============================================================================
-- The tenant's repair link now asks first "Is this an emergency?". An
-- emergency is saved on the report, the landlord is alerted at once (email,
-- and a text where a phone can take one), the tenant sees what to do now, and
-- an approved emergency becomes an urgent work order.
--   incident_reports.emergency_kind  null = not an emergency; else one of the
--                                    kinds in lib/tenant-emergency.ts.
--   properties.emergency_info        what the tenant needs in an emergency
--                                    (water shut-off, breaker panel); shown
--                                    only on that rental's repair link.
--   organizations.emergency_phone    where emergency texts go and the number
--                                    the tenant is told to call. Blank falls
--                                    back to the arrival phone, then the
--                                    listing contact phone.
-- Replaces submit_incident_report (adds p_emergency_kind; DROP + CREATE as in
-- 0066 because the argument list changes), get_incident_report_context (adds
-- emergency_info and emergency_call_phone) and approve_incident_report
-- (an emergency becomes priority urgent). Additive: with every new column
-- null, nothing changes.
-- ============================================================================

alter table public.incident_reports
  add column if not exists emergency_kind text
    check (emergency_kind is null or emergency_kind in
      ('water_leak','sewage','no_heat','no_power','gas_smell','fire_smoke','locked_out'));

alter table public.properties
  add column if not exists emergency_info text
    check (emergency_info is null or length(emergency_info) <= 1000);

alter table public.organizations
  add column if not exists emergency_phone text
    check (emergency_phone is null or length(emergency_phone) <= 40);

-- 1. submit: same rules as 0066, plus the emergency kind.
drop function if exists public.submit_incident_report(text, text, text, text, text, boolean);

create or replace function public.submit_incident_report(
  p_token            text,
  p_category         text,
  p_description      text,
  p_reporter_name    text default null,
  p_reporter_contact text default null,
  p_media_consent    boolean default false,
  p_emergency_kind   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenancy public.tenancies%rowtype;
  v_desc    text;
  v_kind    text;
  v_report  public.incident_reports%rowtype;
begin
  select * into v_tenancy from public.tenancies where report_token = p_token for update;
  if v_tenancy.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_tenancy.status not in ('active','upcoming') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  -- mirror lib/incident-reports.validateReportSubmission exactly.
  if p_category is null or p_category not in
       ('plumbing','electrical','hvac','appliance','structural','pest','landscaping','cleaning','general') then
    return jsonb_build_object('ok', false, 'reason', 'bad_category');
  end if;

  -- mirror lib/tenant-emergency.EMERGENCY_KINDS exactly.
  v_kind := nullif(btrim(coalesce(p_emergency_kind, '')), '');
  if v_kind is not null and v_kind not in
       ('water_leak','sewage','no_heat','no_power','gas_smell','fire_smoke','locked_out') then
    return jsonb_build_object('ok', false, 'reason', 'bad_emergency');
  end if;

  v_desc := btrim(coalesce(p_description, ''));
  if length(v_desc) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'description_required');
  end if;
  if length(v_desc) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'description_too_long');
  end if;

  insert into public.incident_reports (
    organization_id, tenancy_id, property_id,
    reporter_name, reporter_contact,
    category, description, status,
    media_consent_at, emergency_kind
  ) values (
    v_tenancy.organization_id, v_tenancy.id, v_tenancy.property_id,
    nullif(btrim(coalesce(p_reporter_name, '')), ''),
    nullif(btrim(coalesce(p_reporter_contact, '')), ''),
    p_category, v_desc, 'submitted',
    case when coalesce(p_media_consent, false) then now() else null end,
    v_kind
  )
  returning * into v_report;

  return jsonb_build_object(
    'ok', true,
    'report_id', v_report.id,
    'organization_id', v_report.organization_id
  );
end;
$$;

grant execute on function public.submit_incident_report(text, text, text, text, text, boolean, text)
  to anon, authenticated;

-- 2. context: same as 0061, plus what the tenant needs in an emergency.
create or replace function public.get_incident_report_context(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenancy   public.tenancies%rowtype;
  v_org_name  text;
  v_brand     text;
  v_brand2    text;
  v_logo      text;
  v_call      text;
  v_address   text;
  v_info      text;
  v_rep_name  text;
  v_rep_contact text;
begin
  if p_token is null or btrim(p_token) = '' then
    return null;
  end if;

  select * into v_tenancy from public.tenancies where report_token = p_token;
  if v_tenancy.id is null then
    return null;
  end if;

  select o.name, o.brand_color, o.brand_color_secondary, o.logo_url,
         coalesce(nullif(btrim(o.emergency_phone), ''),
                  nullif(btrim(o.public_contact_phone), ''),
                  nullif(btrim(o.showing_arrival_phone), ''))
    into v_org_name, v_brand, v_brand2, v_logo, v_call
  from public.organizations o
  where o.id = v_tenancy.organization_id;

  select p.address, nullif(btrim(p.emergency_info), '') into v_address, v_info
  from public.properties p
  where p.id = v_tenancy.property_id;

  select t.name,
         coalesce(nullif(btrim(t.email), ''), nullif(btrim(t.phone), ''))
    into v_rep_name, v_rep_contact
  from public.tenants t
  where t.tenancy_id = v_tenancy.id
  order by t.is_primary desc, t.created_at asc
  limit 1;

  return jsonb_build_object(
    'token',            v_tenancy.report_token,
    'accepting',        (v_tenancy.status in ('active','upcoming')),
    'tenancy_status',   v_tenancy.status,
    'property_address', v_address,
    'reporter_name',    v_rep_name,
    'reporter_contact', v_rep_contact,
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'brand_color_secondary', v_brand2,
    'logo_url',         v_logo,
    'emergency_info',   v_info,
    'emergency_call_phone', v_call
  );
end;
$$;

grant execute on function public.get_incident_report_context(text) to anon, authenticated;

-- 3. approve: same as 0062, but an emergency becomes an urgent work order.
create or replace function public.approve_incident_report(p_report_id uuid, p_title text default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_report public.incident_reports%rowtype;
  v_title  text;
  v_wo_id  uuid;
begin
  select * into v_report
  from public.incident_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_report.status not in ('submitted', 'under_review') then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null then
    v_title := 'Tenant-reported ' || v_report.category;
  end if;

  insert into public.work_orders (
    organization_id, property_id, tenancy_id,
    title, description, category, priority, status
  ) values (
    v_report.organization_id, v_report.property_id, v_report.tenancy_id,
    left(v_title, 200), v_report.description, v_report.category,
    case when v_report.emergency_kind is not null then 'urgent' else 'normal' end,
    'open'
  )
  returning id into v_wo_id;

  update public.incident_reports
     set status                  = 'converted',
         converted_work_order_id = v_wo_id,
         reviewed_at             = now(),
         updated_at              = now()
   where id = v_report.id;

  return jsonb_build_object('ok', true, 'work_order_id', v_wo_id);
end;
$$;
