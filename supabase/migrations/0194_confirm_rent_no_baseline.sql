-- ============================================================================
-- 0194_confirm_rent_no_baseline — public rent-confirm baseline set mode
--
-- Extends the existing public rent confirmation link for active tenancies whose
-- flat rent read model is missing. A no-baseline tenancy must use status='set'
-- to write one landlord_confirm/original ledger row and seed tenancies.rent_cents.
-- Existing baseline tenancies keep the unchanged/changed behavior from 0192.
-- ============================================================================

create or replace function public.get_rent_confirm_context(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenancy public.tenancies%rowtype;
  v_address text;
  v_primary_tenant text;
  v_already_confirmed boolean;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_tenancy
  from public.tenancies
  where confirm_token = p_token
    and status = 'active';

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select p.address into v_address
  from public.properties p
  where p.id = v_tenancy.property_id
    and p.organization_id = v_tenancy.organization_id;

  if v_address is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select t.name into v_primary_tenant
  from public.tenants t
  where t.tenancy_id = v_tenancy.id
    and t.organization_id = v_tenancy.organization_id
  order by t.is_primary desc, t.created_at asc
  limit 1;

  select exists (
    select 1
    from public.tenancy_rent_adjustments a
    where a.tenancy_id = v_tenancy.id
      and a.organization_id = v_tenancy.organization_id
      and a.source = 'landlord_confirm'
  ) into v_already_confirmed;

  return jsonb_build_object(
    'ok', true,
    'tenancy_id', v_tenancy.id,
    'unit_address', v_address,
    'current_rent_cents', v_tenancy.rent_cents,
    'current_effective_date', coalesce(v_tenancy.last_rent_increase_date, v_tenancy.start_date),
    'primary_tenant_name', v_primary_tenant,
    'already_confirmed', v_already_confirmed,
    'has_baseline', (v_tenancy.rent_cents is not null and v_tenancy.rent_cents > 0)
  );
end;
$$;

grant execute on function public.get_rent_confirm_context(uuid)
  to anon, authenticated;

create or replace function public.confirm_rent_from_token(
  p_token uuid,
  p_status text,
  p_current_rent_cents integer,
  p_effective_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenancy public.tenancies%rowtype;
  v_already_confirmed boolean;
  v_has_baseline boolean;
  v_has_original boolean;
  v_kind text;
begin
  if p_token is null or p_status is null or p_status not in ('unchanged','changed','set') then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  select * into v_tenancy
  from public.tenancies
  where confirm_token = p_token
    and status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select exists (
    select 1
    from public.tenancy_rent_adjustments a
    where a.tenancy_id = v_tenancy.id
      and a.organization_id = v_tenancy.organization_id
      and a.source = 'landlord_confirm'
  ) into v_already_confirmed;

  if v_already_confirmed then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  v_has_baseline := v_tenancy.rent_cents is not null and v_tenancy.rent_cents > 0;

  if not v_has_baseline then
    if p_status <> 'set' then
      return jsonb_build_object('ok', false, 'reason', 'bad_input');
    end if;
    if p_current_rent_cents is null or p_current_rent_cents <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'bad_input');
    end if;
    if p_effective_date is null or p_effective_date < v_tenancy.start_date then
      return jsonb_build_object('ok', false, 'reason', 'bad_input');
    end if;

    insert into public.tenancy_rent_adjustments (
      organization_id,
      tenancy_id,
      effective_date,
      rent_cents,
      kind,
      source,
      note,
      created_by,
      created_at
    )
    values (
      v_tenancy.organization_id,
      v_tenancy.id,
      p_effective_date,
      p_current_rent_cents,
      'original',
      'landlord_confirm',
      null,
      null,
      now()
    );

    update public.tenancies
       set rent_cents = p_current_rent_cents,
           last_rent_increase_date = p_effective_date,
           rent_increase_nudged_for = null,
           updated_at = now()
     where id = v_tenancy.id;

    return jsonb_build_object('ok', true, 'status', 'set');
  end if;

  if p_status = 'set' then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  if p_status = 'changed' then
    if p_current_rent_cents is null or p_current_rent_cents <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'bad_input');
    end if;
    if p_effective_date is null or p_effective_date < v_tenancy.start_date then
      return jsonb_build_object('ok', false, 'reason', 'bad_input');
    end if;
  end if;

  select exists (
    select 1
    from public.tenancy_rent_adjustments a
    where a.tenancy_id = v_tenancy.id
      and a.organization_id = v_tenancy.organization_id
      and a.kind = 'original'
      and a.source = 'landlord_confirm'
  ) into v_has_original;

  if not v_has_original then
    insert into public.tenancy_rent_adjustments (
      organization_id,
      tenancy_id,
      effective_date,
      rent_cents,
      kind,
      source,
      note,
      created_by,
      created_at
    )
    values (
      v_tenancy.organization_id,
      v_tenancy.id,
      v_tenancy.start_date,
      v_tenancy.rent_cents,
      'original',
      'landlord_confirm',
      null,
      null,
      now()
    );
  end if;

  if p_status = 'unchanged' then
    update public.tenancies
       set last_rent_increase_date = null,
           rent_increase_nudged_for = null,
           updated_at = now()
     where id = v_tenancy.id;

    return jsonb_build_object('ok', true, 'status', 'unchanged');
  end if;

  v_kind := case
    when p_current_rent_cents > v_tenancy.rent_cents then 'increase'
    when p_current_rent_cents < v_tenancy.rent_cents then 'reduction'
    else 'altered_term'
  end;

  insert into public.tenancy_rent_adjustments (
    organization_id,
    tenancy_id,
    effective_date,
    rent_cents,
    kind,
    source,
    note,
    created_by,
    created_at
  )
  values (
    v_tenancy.organization_id,
    v_tenancy.id,
    p_effective_date,
    p_current_rent_cents,
    v_kind,
    'landlord_confirm',
    'Landlord confirmed current effective rent from the public rent-confirm link.',
    null,
    now() + interval '1 millisecond'
  );

  update public.tenancies
     set rent_cents = p_current_rent_cents,
         last_rent_increase_date = p_effective_date,
         rent_increase_nudged_for = null,
         updated_at = now()
   where id = v_tenancy.id;

  return jsonb_build_object('ok', true, 'status', 'changed');
end;
$$;

grant execute on function public.confirm_rent_from_token(uuid, text, integer, date)
  to anon, authenticated;
