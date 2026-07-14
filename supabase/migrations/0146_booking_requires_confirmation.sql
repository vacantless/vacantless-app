-- ============================================================================
-- 0146_booking_requires_confirmation (S490)
--
-- Per-org copy gate for renter self-booking confirmations. Default false keeps
-- the existing instant-book copy everywhere; Agile opts in so renters are told
-- an agent will confirm before the viewing. This is copy-only: the slot remains
-- reserved by book_public_showing.
-- ============================================================================

alter table public.organizations
  add column if not exists booking_requires_confirmation boolean not null default false;

comment on column public.organizations.booking_requires_confirmation is
  'S490: copy-only booking-confirmation gate. When true, renters are told an agent will confirm before the viewing.';

update public.organizations
set booking_requires_confirmation = true
where slug = 'agile'
   or lower(coalesce(reply_to_email, '')) = 'rentals@agileonline.ca'
   or lower(coalesce(public_contact_email, '')) = 'rentals@agileonline.ca';

-- get_public_listing: recreated from 0116 with one added key,
-- booking_requires_confirmation, so the public /r success copy can branch
-- without exposing a direct organizations read.
create or replace function public.get_public_listing(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',               p.id,
    'address',          p.address,
    'rent_cents',       p.rent_cents,
    'beds',             p.beds,
    'baths',            p.baths,
    'parking',          p.parking,
    'description',      p.description,
    'status',           p.status,
    'available_date',   p.available_date,
    'sqft',             p.sqft,
    'floor',            p.floor,
    'laundry',          p.laundry,
    'air_conditioning', p.air_conditioning,
    'balcony',          p.balcony,
    'furnished',        p.furnished,
    'pets_cats',        coalesce(p.pets_cats, bp.policy_pets_cats, o.policy_pets_cats, false),
    'pets_dogs',        coalesce(p.pets_dogs, bp.policy_pets_dogs, o.policy_pets_dogs, false),
    'pet_friendly',     (coalesce(p.pets_cats, bp.policy_pets_cats, o.policy_pets_cats, false)
                          or coalesce(p.pets_dogs, bp.policy_pets_dogs, o.policy_pets_dogs, false)),
    'pets_dog_size',    coalesce(p.pets_dog_size, bp.policy_pets_dog_size, o.policy_pets_dog_size),
    'pets_notes',       p.pets_notes,
    'heat_included',    coalesce(p.heat_included,  bp.policy_heat_included,  o.policy_heat_included,  false),
    'hydro_included',   coalesce(p.hydro_included, bp.policy_hydro_included, o.policy_hydro_included, false),
    'water_included',   coalesce(p.water_included, bp.policy_water_included, o.policy_water_included, false),
    'virtual_tour_url', p.virtual_tour_url,
    'lease_term',         coalesce(p.lease_term,         bp.policy_lease_term,         o.policy_lease_term),
    'smoking',            coalesce(p.smoking,            bp.policy_smoking,            o.policy_smoking),
    'ac_type',            coalesce(p.ac_type,            bp.policy_ac_type,            o.policy_ac_type),
    'on_site_management', coalesce(p.on_site_management, bp.policy_on_site_management, o.policy_on_site_management),
    'org_name',         o.name,
    'brand_color',      o.brand_color,
    'brand_color_secondary', o.brand_color_secondary,
    'logo_url',         o.logo_url,
    'screening_enabled', o.screening_enabled,
    'booking_requires_confirmation', o.booking_requires_confirmation,
    'screening_ask_income',    o.screening_ask_income,
    'screening_ask_movein',    o.screening_ask_movein,
    'screening_ask_pets',      o.screening_ask_pets,
    'screening_ask_occupants', o.screening_ask_occupants,
    'screening_questions', case when o.screening_enabled then coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',       q.id,
                 'prompt',   q.prompt,
                 'qtype',    q.qtype,
                 'required', q.required,
                 'choices',  case when q.qtype = 'units' then coalesce((
                                select jsonb_agg(p2.address order by p2.address)
                                from public.properties p2
                                where p2.organization_id = o.id
                                  and p2.status = 'available'
                                  and p2.id <> p.id
                              ), '[]'::jsonb)
                              else to_jsonb(q.choices) end)
               order by q.position asc, q.created_at asc)
      from public.org_screening_questions q
      where q.organization_id = o.id and q.active
    ), '[]'::jsonb) else '[]'::jsonb end,
    'photos',           coalesce((
      select jsonb_agg(ph.url order by ph.is_cover desc, ph.sort_order asc, ph.created_at asc)
      from public.property_photos ph
      where ph.property_id = p.id
    ), '[]'::jsonb)
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  left join public.org_building_policies bp
    on bp.organization_id = p.organization_id
   and bp.building_key = p.building_key
  where p.id = p_property_id
    and p.status not in ('off_market', 'draft');
$$;

grant execute on function public.get_public_listing(uuid) to anon, authenticated;

-- get_booking_confirmation_extras: add the same flag to the anon-safe extras
-- payload already used by attemptBooking before sending renter email/SMS.
create or replace function public.get_booking_confirmation_extras(p_property_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'leasing_phone', coalesce(
        nullif(btrim(p.showing_arrival_phone), ''),
        nullif(btrim(o.showing_arrival_phone), ''),
        o.public_contact_phone
      ),
    'plan', o.plan,
    'booking_requires_confirmation', o.booking_requires_confirmation
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id;
$function$;

grant execute on function public.get_booking_confirmation_extras(uuid)
  to anon, authenticated;
