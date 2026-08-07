-- S629 Lane B: org-scoped "require a phone number on inquiries" (default OFF).
--
-- Additive + ships dark: a new boolean column on organizations (false for every
-- org) surfaced through get_public_listing so the public renter page and the
-- submitLead server action can read it. No RLS change (org-scoped column, existing
-- policies cover it); no backfill. The renter form makes the phone field
-- `required` only when this flag is true; submitLead enforces it server-side.
--
-- The function body below is the exact prod definition of get_public_listing with
-- ONE added field ('inquiry_require_phone', o.inquiry_require_phone) placed right
-- after screening_ask_occupants. Verified in a rolled-back transaction against
-- prod: returns 42 keys (41 originals + the new field), value false by default.

alter table public.organizations
  add column if not exists inquiry_require_phone boolean not null default false;

create or replace function public.get_public_listing(p_property_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id',               p.id,
    'address',          p.address,
    'address_display_mode', p.address_display_mode,
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
    'inquiry_require_phone',   o.inquiry_require_phone,
    'screening_questions', case when o.screening_enabled then coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',       q.id,
                 'prompt',   q.prompt,
                 'qtype',    q.qtype,
                 'required', q.required,
                 'choices',  case when q.qtype = 'units' then coalesce((
                                select jsonb_agg(
                                  public.public_address_label(p2.address, p2.address_display_mode)
                                  order by p2.address
                                )
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
$function$;
