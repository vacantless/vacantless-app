-- 0308 (S818): the applicant sees the account's credit check link only after
-- the landlord presses "Ask for credit check" on them. One check per vacancy:
-- in Ontario the landlord pays for it and cannot charge the applicant (RTA;
-- O. Reg. 290/98 allows asking for consent, not a fee). Noam 2026-11-18.
-- Replaces the 0304 read; same shape plus credit_check_status. Grants repeated
-- in this file (rule 431).
create or replace function public.get_rental_application_by_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app     public.rental_applications%rowtype;
  v_org     public.organizations%rowtype;
  v_address text;
  v_asked   boolean;
begin
  select * into v_app from public.rental_applications where public_token = p_token;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_org from public.organizations where id = v_app.organization_id;
  select address into v_address from public.properties where id = v_app.property_id;
  v_asked := v_app.credit_check_status = 'asked' and v_app.status <> 'declined';
  return jsonb_build_object(
    'ok', true,
    'status', v_app.status,
    'applicant_name', v_app.applicant_name,
    'applicant_email', v_app.applicant_email,
    'applicant_phone', v_app.applicant_phone,
    'property_address', v_address,
    'org_name', v_org.name,
    'brand_color', v_org.brand_color,
    'brand_color_secondary', v_org.brand_color_secondary,
    'logo_url', v_org.logo_url,
    'screening_link_url', case when v_asked then v_org.screening_link_url end,
    'screening_link_name', case when v_asked then v_org.screening_link_name end,
    'credit_check_status', v_app.credit_check_status,
    'signed_name', v_app.signed_name,
    'submitted', (v_app.status <> 'requested')
  );
end;
$$;
grant execute on function public.get_rental_application_by_token(uuid) to anon, authenticated;
