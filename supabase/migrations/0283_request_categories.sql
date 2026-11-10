-- ============================================================================
-- Vacantless - S776c: repair categories and one emergency from Agile's requests.
-- ============================================================================
-- Agile's 138 Buildium tenant requests (Oct 2025 to Nov 2026, read 2026-11-10)
-- had no home for doors, locks and keys (22, the second-largest group),
-- parking (7), noise or neighbours (4) and things that are not repairs (13:
-- notices, rent, questions). The most common urgent one, a front door that
-- would not lock or close, was not on the emergency list.
--   incident_reports.category  adds doors_locks, parking, noise, not_repair
--   work_orders.category       adds doors_locks, parking (repairs only)
--   incident_reports.emergency_kind  adds door_unsecured
-- submit_incident_report takes the new values; approve_incident_report refuses
-- noise and not_repair (reason 'message'): they are messages, not work orders.
-- Additive: every existing value stays valid.
-- ============================================================================

alter table public.incident_reports drop constraint if exists incident_reports_category_check;
alter table public.incident_reports add constraint incident_reports_category_check
  check (category in ('plumbing','electrical','hvac','appliance','structural','pest','landscaping','cleaning','general','doors_locks','parking','noise','not_repair'));

alter table public.work_orders drop constraint if exists work_orders_category_check;
alter table public.work_orders add constraint work_orders_category_check
  check (category in ('plumbing','electrical','hvac','appliance','structural','pest','landscaping','cleaning','general','doors_locks','parking'));

alter table public.incident_reports drop constraint if exists incident_reports_emergency_kind_check;
alter table public.incident_reports add constraint incident_reports_emergency_kind_check
  check (emergency_kind is null or emergency_kind in ('water_leak','sewage','no_heat','no_power','gas_smell','fire_smoke','locked_out','door_unsecured'));

-- 1. submit: same as 0281 with the new values.
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

  -- mirror lib/incident-reports INCIDENT_CATEGORIES exactly (S776c, 0283).
  if p_category is null or p_category not in
       ('plumbing','electrical','hvac','appliance','structural','pest','landscaping','cleaning','general','doors_locks','parking','noise','not_repair') then
    return jsonb_build_object('ok', false, 'reason', 'bad_category');
  end if;

  -- mirror lib/tenant-emergency.EMERGENCY_KINDS exactly.
  v_kind := nullif(btrim(coalesce(p_emergency_kind, '')), '');
  if v_kind is not null and v_kind not in
       ('water_leak','sewage','no_heat','no_power','gas_smell','fire_smoke','locked_out','door_unsecured') then
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

-- 2. approve: same as 0281, but a message never becomes a work order.
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

  -- S776c: noise and "not a repair" are messages to the landlord, never a work order.
  if v_report.category in ('noise','not_repair') then
    return jsonb_build_object('ok', false, 'reason', 'message');
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
