-- 0125_rental_applications.sql
-- S453, Slice 1: rental-application CAPTURE (own Form-410-equivalent).
--
-- MODEL B (never-persist-tenant-PII): this table holds ONLY the non-sensitive
-- record + the consent acknowledgement + the tokenized-link machinery. The
-- regulated identifiers (SIN, DOB, driver's licence, uploaded income/ID docs)
-- are NEVER stored here — they go to the screening provider's hosted form in
-- Slice 2. The submit RPC below strips those keys from form_data in SQL, so the
-- guardrail holds even against a direct anon RPC call.
--
-- Public flow mirrors the tokenized /r + record_showing_outcome_from_token (0098)
-- precedent: anon has NO table access; the applicant page reaches the row only
-- through the two SECURITY DEFINER, token-keyed RPCs. Reversible. No change to
-- existing tables or RLS.

create table if not exists public.rental_applications (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  lead_id                 uuid not null references public.leads(id) on delete cascade,
  property_id             uuid references public.properties(id) on delete set null,
  person_id               uuid references public.persons(id) on delete set null,
  status                  text not null default 'requested'
                            check (status in ('requested','submitted','screening','complete','declined')),
  public_token            uuid not null default gen_random_uuid(),
  pay_mode                text not null default 'applicant'
                            check (pay_mode in ('applicant','landlord')),
  applicant_name          text,
  applicant_email         text,
  applicant_phone         text,
  applicant_email_norm    text,
  applicant_phone_e164    text,
  form_data               jsonb not null default '{}'::jsonb,
  consent_acknowledged_at timestamptz,
  requested_by            uuid,
  requested_at            timestamptz not null default now(),
  submitted_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists uq_rental_applications_token
  on public.rental_applications (public_token);
create index if not exists idx_rental_applications_org
  on public.rental_applications (organization_id);
create index if not exists idx_rental_applications_lead
  on public.rental_applications (lead_id);

alter table public.rental_applications enable row level security;

drop policy if exists rental_applications_all on public.rental_applications;
create policy rental_applications_all on public.rental_applications
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.rental_applications to authenticated;
-- anon reaches the row ONLY through the SECURITY DEFINER RPCs below.
revoke all on public.rental_applications from anon;

-- ---------------------------------------------------------------------------
-- RPC 1: read the non-sensitive shell for the public applicant page, by token.
-- ---------------------------------------------------------------------------
create or replace function public.get_rental_application_by_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app       public.rental_applications%rowtype;
  v_org       public.organizations%rowtype;
  v_address   text;
begin
  select * into v_app
  from public.rental_applications
  where public_token = p_token;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_org from public.organizations where id = v_app.organization_id;
  select address into v_address from public.properties where id = v_app.property_id;

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
    'submitted', (v_app.status <> 'requested')
  );
end;
$$;

grant execute on function public.get_rental_application_by_token(uuid)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC 2: the applicant submit. Requires consent; only from 'requested'
-- (idempotent guard); strips sensitive keys from form_data at the storage
-- boundary; logs a lead-timeline note (mirror of 0098).
-- ---------------------------------------------------------------------------
create or replace function public.submit_rental_application(
  p_token          uuid,
  p_form_data      jsonb,
  p_consent        boolean,
  p_applicant_name text,
  p_applicant_email text,
  p_applicant_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.rental_applications%rowtype;
begin
  if p_consent is not true then
    return jsonb_build_object('ok', false, 'reason', 'consent_required');
  end if;

  select * into v_app
  from public.rental_applications
  where public_token = p_token
  for update;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_app.status <> 'requested' then
    return jsonb_build_object('ok', false, 'reason', 'already_submitted');
  end if;

  update public.rental_applications
     set applicant_name       = coalesce(nullif(btrim(p_applicant_name), ''),  applicant_name),
         applicant_email      = coalesce(nullif(btrim(p_applicant_email), ''), applicant_email),
         applicant_phone      = coalesce(nullif(btrim(p_applicant_phone), ''), applicant_phone),
         applicant_email_norm = lower(nullif(btrim(p_applicant_email), '')),
         -- Storage-boundary strip of the never-persist sensitive keys (mirrors
         -- lib/rental-application SENSITIVE_BLOCKED_FIELDS).
         form_data = (coalesce(p_form_data, '{}'::jsonb)
                       - 'sin' - 'social_insurance_number'
                       - 'dob' - 'date_of_birth'
                       - 'driver_licence' - 'drivers_license' - 'driver_license'
                       - 'income_documents' - 'income_docs' - 'id_document'),
         consent_acknowledged_at = now(),
         submitted_at            = now(),
         status                  = 'submitted',
         updated_at              = now()
   where id = v_app.id;

  insert into public.messages (organization_id, lead_id, channel, direction, body)
  values (v_app.organization_id, v_app.lead_id, 'note', 'outbound',
          'Rental application submitted.');

  return jsonb_build_object('ok', true, 'status', 'submitted');
end;
$$;

grant execute on function public.submit_rental_application(uuid, jsonb, boolean, text, text, text)
  to anon, authenticated;
