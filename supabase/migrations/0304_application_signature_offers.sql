-- 0304 (S816): signed rental applications, co-applicants, offers, credit check link.
-- Noam 2026-11-17: "Proceed with 1 to 4" (signed authorization, credit check,
-- an offer step, co-applicants and showing agents sending the application) and
-- "it has to be easy to use and be easily accessible and integrated".
--
-- Additive only. The old submit_rental_application stays so an application
-- opened on the previous build keeps working until the new build is live.

-- 1. Signature + credit check on each application ---------------------------
alter table public.rental_applications
  add column if not exists signed_name        text,
  add column if not exists signed_at          timestamptz,
  add column if not exists signer_ip          text,
  add column if not exists signer_user_agent  text,
  add column if not exists consent_text       text,
  add column if not exists credit_check_status text
    check (credit_check_status in ('asked','received')),
  add column if not exists credit_check_at    timestamptz,
  add column if not exists sent_by_agent_id   uuid references public.showing_agents(id) on delete set null;

-- The account's own screening company link (any provider; Vacantless never
-- holds the report). Shown to the applicant right after they sign.
alter table public.organizations
  add column if not exists screening_link_url  text,
  add column if not exists screening_link_name text;

-- Public read: now also returns the screening link and the signature state.
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
begin
  select * into v_app from public.rental_applications where public_token = p_token;
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
    'screening_link_url', v_org.screening_link_url,
    'screening_link_name', v_org.screening_link_name,
    'signed_name', v_app.signed_name,
    'submitted', (v_app.status <> 'requested')
  );
end;
$$;
grant execute on function public.get_rental_application_by_token(uuid) to anon, authenticated;

-- Signed submit: the typed full name is the signature; the exact words they
-- agreed to, the time, IP and device are kept with it.
create or replace function public.submit_rental_application_signed(
  p_token           uuid,
  p_form_data       jsonb,
  p_signed_name     text,
  p_consent_text    text,
  p_applicant_name  text,
  p_applicant_email text,
  p_applicant_phone text,
  p_ip              text default null,
  p_user_agent      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.rental_applications%rowtype;
begin
  if p_signed_name is null or length(btrim(p_signed_name)) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'signature_required');
  end if;
  if p_consent_text is null or btrim(p_consent_text) = '' then
    return jsonb_build_object('ok', false, 'reason', 'consent_required');
  end if;
  if p_applicant_name is null or btrim(p_applicant_name) = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  select * into v_app from public.rental_applications where public_token = p_token for update;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_app.status <> 'requested' then
    return jsonb_build_object('ok', false, 'reason', 'already_submitted');
  end if;

  update public.rental_applications
     set applicant_name       = btrim(p_applicant_name),
         applicant_email      = coalesce(nullif(btrim(p_applicant_email), ''), applicant_email),
         applicant_phone      = coalesce(nullif(btrim(p_applicant_phone), ''), applicant_phone),
         applicant_email_norm = coalesce(lower(nullif(btrim(p_applicant_email), '')), applicant_email_norm),
         form_data = coalesce((
           select jsonb_object_agg(lower(e.key), e.value)
           from jsonb_each(coalesce(p_form_data, '{}'::jsonb)) as e
           where lower(e.key) in (
             'current_address','current_duration','current_rent',
             'current_landlord_name','current_landlord_contact','current_reason_leaving',
             'previous_address','previous_duration','previous_landlord_name',
             'previous_landlord_contact','employer','position','employment_length',
             'supervisor_contact','gross_income','second_employer','second_income',
             'other_income','bank_reference_institution','reference_1_name',
             'reference_1_contact','reference_2_name','reference_2_contact',
             'vehicles','occupants','smoking','pets','emergency_contact_name',
             'emergency_contact_phone'
           )
           and jsonb_typeof(e.value) in ('string','number','boolean')
         ), '{}'::jsonb),
         signed_name             = btrim(p_signed_name),
         signed_at               = now(),
         signer_ip               = left(p_ip, 100),
         signer_user_agent       = left(p_user_agent, 400),
         consent_text            = left(p_consent_text, 2000),
         consent_acknowledged_at = now(),
         submitted_at            = now(),
         status                  = 'submitted',
         updated_at              = now()
   where id = v_app.id;

  insert into public.messages (organization_id, lead_id, channel, direction, body)
  values (v_app.organization_id, v_app.lead_id, 'note', 'outbound',
          'Rental application signed and submitted by ' || btrim(p_signed_name) || '.');

  return jsonb_build_object('ok', true, 'status', 'submitted');
end;
$$;
grant execute on function public.submit_rental_application_signed(uuid, jsonb, text, text, text, text, text, text, text)
  to anon, authenticated;

-- 2. Offers ---------------------------------------------------------------
create table if not exists public.application_offers (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  lead_id              uuid not null references public.leads(id) on delete cascade,
  property_id          uuid references public.properties(id) on delete set null,
  rent_cents           integer not null check (rent_cents > 0),
  deposit_cents        integer check (deposit_cents is null or deposit_cents >= 0),
  start_date           date not null,
  term_months          integer check (term_months is null or term_months between 1 and 60),
  conditions           text,
  status               text not null default 'sent'
                         check (status in ('sent','accepted','declined','withdrawn')),
  landlord_signed_name text not null,
  landlord_signed_at   timestamptz not null default now(),
  created_by           uuid,
  accepted_at          timestamptz,
  tenancy_id           uuid references public.tenancies(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_application_offers_lead on public.application_offers (lead_id);
create index if not exists idx_application_offers_org on public.application_offers (organization_id);

create table if not exists public.application_offer_signers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  offer_id        uuid not null references public.application_offers(id) on delete cascade,
  application_id  uuid references public.rental_applications(id) on delete set null,
  person_id       uuid references public.persons(id) on delete set null,
  name            text,
  email           text,
  token           uuid not null default gen_random_uuid(),
  status          text not null default 'pending' check (status in ('pending','signed','declined')),
  signed_name     text,
  signed_at       timestamptz,
  signer_ip       text,
  user_agent      text,
  created_at      timestamptz not null default now()
);
create unique index if not exists uq_application_offer_signers_token on public.application_offer_signers (token);
create index if not exists idx_application_offer_signers_offer on public.application_offer_signers (offer_id);
create index if not exists idx_application_offer_signers_person on public.application_offer_signers (person_id);

alter table public.application_offers enable row level security;
alter table public.application_offer_signers enable row level security;
drop policy if exists application_offers_all on public.application_offers;
create policy application_offers_all on public.application_offers
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));
drop policy if exists application_offer_signers_all on public.application_offer_signers;
create policy application_offer_signers_all on public.application_offer_signers
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));
grant select, insert, update, delete on public.application_offers to authenticated;
grant select, insert, update, delete on public.application_offer_signers to authenticated;
revoke all on public.application_offers from anon;
revoke all on public.application_offer_signers from anon;

-- Public read of one signer's offer.
create or replace function public.get_application_offer_by_token(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_signer public.application_offer_signers%rowtype;
  v_offer  public.application_offers%rowtype;
  v_org    public.organizations%rowtype;
  v_address text;
  v_others jsonb;
begin
  select * into v_signer from public.application_offer_signers where token = p_token;
  if v_signer.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_offer from public.application_offers where id = v_signer.offer_id;
  select * into v_org from public.organizations where id = v_offer.organization_id;
  select address into v_address from public.properties where id = v_offer.property_id;
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'status', s.status) order by s.created_at), '[]'::jsonb)
    into v_others
  from public.application_offer_signers s
  where s.offer_id = v_offer.id and s.id <> v_signer.id;

  return jsonb_build_object(
    'ok', true,
    'signer_name', v_signer.name,
    'signer_status', v_signer.status,
    'signed_name', v_signer.signed_name,
    'offer_status', v_offer.status,
    'signable', (v_offer.status = 'sent' and v_signer.status = 'pending'),
    'rent_cents', v_offer.rent_cents,
    'deposit_cents', v_offer.deposit_cents,
    'start_date', v_offer.start_date,
    'term_months', v_offer.term_months,
    'conditions', v_offer.conditions,
    'landlord_signed_name', v_offer.landlord_signed_name,
    'landlord_signed_at', v_offer.landlord_signed_at,
    'property_address', v_address,
    'org_name', v_org.name,
    'brand_color', v_org.brand_color,
    'brand_color_secondary', v_org.brand_color_secondary,
    'logo_url', v_org.logo_url,
    'others', v_others
  );
end;
$$;
grant execute on function public.get_application_offer_by_token(uuid) to anon, authenticated;

-- Public accept / decline. The last applicant to sign makes the offer accepted.
create or replace function public.sign_application_offer(
  p_token       uuid,
  p_signed_name text,
  p_accept      boolean,
  p_ip          text default null,
  p_user_agent  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signer    public.application_offer_signers%rowtype;
  v_offer     public.application_offers%rowtype;
  v_remaining integer;
begin
  select * into v_signer from public.application_offer_signers where token = p_token for update;
  if v_signer.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_signer.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_signed');
  end if;
  select * into v_offer from public.application_offers where id = v_signer.offer_id for update;
  if v_offer.status <> 'sent' then
    return jsonb_build_object('ok', false, 'reason', 'not_signable');
  end if;
  if p_signed_name is null or length(btrim(p_signed_name)) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'signature_required');
  end if;

  if p_accept is not true then
    update public.application_offer_signers
       set status = 'declined', signed_name = btrim(p_signed_name), signed_at = now(),
           signer_ip = left(p_ip, 100), user_agent = left(p_user_agent, 400)
     where id = v_signer.id;
    update public.application_offers set status = 'declined', updated_at = now() where id = v_offer.id;
    insert into public.messages (organization_id, lead_id, channel, direction, body)
    values (v_offer.organization_id, v_offer.lead_id, 'note', 'inbound',
            'Offer declined by ' || btrim(p_signed_name) || '.');
    return jsonb_build_object('ok', true, 'declined', true);
  end if;

  update public.application_offer_signers
     set status = 'signed', signed_name = btrim(p_signed_name), signed_at = now(),
         signer_ip = left(p_ip, 100), user_agent = left(p_user_agent, 400)
   where id = v_signer.id;

  select count(*) into v_remaining
  from public.application_offer_signers
  where offer_id = v_offer.id and status <> 'signed';

  insert into public.messages (organization_id, lead_id, channel, direction, body)
  values (v_offer.organization_id, v_offer.lead_id, 'note', 'inbound',
          'Offer signed by ' || btrim(p_signed_name) ||
          case when v_remaining = 0 then '. Everyone has signed: the offer is accepted.' else '.' end);

  if v_remaining = 0 then
    update public.application_offers
       set status = 'accepted', accepted_at = now(), updated_at = now()
     where id = v_offer.id;
  end if;

  return jsonb_build_object('ok', true, 'all_signed', (v_remaining = 0));
end;
$$;
grant execute on function public.sign_application_offer(uuid, text, boolean, text, text) to anon, authenticated;
