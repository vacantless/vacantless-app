-- ============================================================================
-- Vacantless - S776b: an emergency phone per rental.
-- ============================================================================
-- Noam 2026-11-10: "can the landlord assign the emergency call to the super or
-- property manager of choosing?" 0281 gave one Emergency phone per account.
-- This lets each rental name its own (the super at one building, the property
-- manager at another), like the per-rental arrival phone (S471):
--   properties.emergency_phone  blank = the account's Emergency phone.
-- get_incident_report_context now tells the tenant the rental's number first.
-- The text target (lib/tenant-emergency emergencyTextTarget) reads it in the app.
-- Additive: with every value null, nothing changes.
-- ============================================================================

alter table public.properties
  add column if not exists emergency_phone text
    check (emergency_phone is null or length(emergency_phone) <= 40);

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
  v_prop_phone text;
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

  select p.address, nullif(btrim(p.emergency_info), ''), nullif(btrim(p.emergency_phone), '')
    into v_address, v_info, v_prop_phone
  from public.properties p
  where p.id = v_tenancy.property_id;

  select o.name, o.brand_color, o.brand_color_secondary, o.logo_url,
         coalesce(v_prop_phone,
                  nullif(btrim(o.emergency_phone), ''),
                  nullif(btrim(o.public_contact_phone), ''),
                  nullif(btrim(o.showing_arrival_phone), ''))
    into v_org_name, v_brand, v_brand2, v_logo, v_call
  from public.organizations o
  where o.id = v_tenancy.organization_id;

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
