-- S309: an off-market unit must show the "no longer available" referral page,
-- not a 404.
--
-- Today archiveProperty sets status='off_market'. get_public_listing filters
-- off_market out, so app/r/[propertyId] hits `if (!listing) notFound()` and the
-- shared link dies. The referral page it should have shown already exists and is
-- fully built (heading "This rental is no longer available", the "Available now"
-- sibling list, the waitlist form) but only ever renders for status='leased',
-- because 'leased' is the one non-available status the RPC lets through.
--
-- Measured cost of the 404 on 2026-08-31: 1551 Assumption St Unit D drew 64
-- enquiries in 14 days, rented on 2026-08-28, and its link then returned 404 to
-- everyone holding it. Five renters reported the link broken; one called it
-- spam. The landlord independently raised the same loss from his side: enquiries
-- on a rented unit used to be walked over to the vacant ones by hand.
--
-- Fix: both public RPCs stop excluding 'off_market'. 'draft' stays excluded:
-- a draft was never published and must not leak.
--
-- Safety, all pre-existing and unchanged by this migration:
--   * the page computes isAvailable = (status === 'available'), so an off-market
--     unit renders the gone-state, not a booking form
--   * generateMetadata sets robots noindex for any status !== 'available'
--   * submit_public_lead requires status = 'available' and hard-blocks the rest
--   * get_public_availability already excludes off_market, so no slots are offered
--   * join_waitlist has no status guard, which is what the gone-state needs
-- The only new capability is that the page renders at all.

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
    and p.status <> 'draft';
$function$;

grant execute on function public.get_public_listing(uuid) to anon, authenticated;

create or replace function public.get_public_leaseup_siblings(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with source as (
    select id, organization_id, beds, unit_type
    from public.properties
    where id = p_property_id
      and status <> 'draft'
  ),
  siblings as (
    select
      p.id,
      p.address,
      p.address_display_mode,
      p.rent_cents,
      p.beds,
      p.baths,
      p.available_date
    from public.properties p
    join source s on s.organization_id = p.organization_id
    where p.id <> s.id
      and p.status = 'available'
      and (s.beds is null or p.beds is null or p.beds = s.beds)
      and (s.unit_type is null or p.unit_type is null or p.unit_type = s.unit_type)
    order by p.available_date nulls last, p.address asc
    limit 6
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', siblings.id,
        'address', siblings.address,
        'address_display_mode', siblings.address_display_mode,
        'rent_cents', siblings.rent_cents,
        'beds', siblings.beds,
        'baths', siblings.baths,
        'available_date', siblings.available_date
      )
      order by siblings.available_date nulls last, siblings.address asc
    ),
    '[]'::jsonb
  )
  from siblings;
$$;

grant execute on function public.get_public_leaseup_siblings(uuid) to anon, authenticated;
