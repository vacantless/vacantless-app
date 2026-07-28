-- ============================================================================
-- 0195_property_address_privacy
--
-- Let operators choose how much address detail Vacantless-hosted public surfaces
-- show. Portal syndication feed RPCs intentionally remain unchanged because
-- Kijiji/Rentals.ca/Zumper-style posting paths require the true full address.
-- ============================================================================

alter table public.properties
  add column if not exists address_display_mode text not null default 'full';

update public.properties
set address_display_mode = 'full'
where address_display_mode is null
   or address_display_mode not in ('full', 'hide_unit', 'approximate');

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'properties_address_display_mode_check'
  ) then
    alter table public.properties
      add constraint properties_address_display_mode_check
      check (address_display_mode = any (array[
        'full'::text,
        'hide_unit'::text,
        'approximate'::text
      ]));
  end if;
end $$;

comment on column public.properties.address_display_mode is
  'Controls address display on Vacantless-hosted public listing/browse surfaces only. Portal feeds always use the full address required for posting. Default full preserves existing listings.';

create or replace function public.public_address_label(
  p_address text,
  p_address_display_mode text
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_mode text := case
    when p_address_display_mode in ('hide_unit', 'approximate') then p_address_display_mode
    else 'full'
  end;
  v_unitless text;
  v_first text;
  v_street text;
  v_city text;
begin
  if v_address is null then
    return '';
  end if;

  if v_mode = 'full' then
    return v_address;
  end if;

  v_unitless := v_address;
  v_unitless := regexp_replace(
    v_unitless,
    '^[[:space:]]*(unit|suite|ste|apt|apartment)[[:space:]]+[[:alnum:]-]+[[:space:]]*[-,][[:space:]]*',
    '',
    'i'
  );
  v_unitless := regexp_replace(
    v_unitless,
    '^[[:space:]]*#[[:alnum:]-]+[[:space:]]*[-,]?[[:space:]]*',
    '',
    'i'
  );
  v_unitless := regexp_replace(
    v_unitless,
    '[[:space:]]*,[[:space:]]*(unit|suite|ste|apt|apartment)[[:space:]]+[[:alnum:]-]+',
    '',
    'gi'
  );
  v_unitless := regexp_replace(
    v_unitless,
    '[[:space:]]*,[[:space:]]*#[[:alnum:]-]+',
    '',
    'gi'
  );
  v_unitless := regexp_replace(
    v_unitless,
    '[[:space:]]+(unit|suite|ste|apt|apartment)[[:space:]]+[[:alnum:]-]+([[:space:]]*,|$)',
    '\2',
    'gi'
  );
  v_unitless := regexp_replace(
    v_unitless,
    '[[:space:]]+#[[:alnum:]-]+([[:space:]]*,|$)',
    '\1',
    'gi'
  );
  v_unitless := btrim(regexp_replace(v_unitless, '[[:space:]]+', ' ', 'g'));
  v_unitless := btrim(regexp_replace(v_unitless, '[[:space:]]*,[[:space:]]*,+', ', ', 'g'));
  v_unitless := btrim(v_unitless, ' ,-');

  if v_mode = 'hide_unit' then
    return coalesce(nullif(v_unitless, ''), '');
  end if;

  v_first := nullif(btrim(split_part(v_unitless, ',', 1)), '');
  v_city := nullif(btrim(split_part(v_unitless, ',', 2)), '');
  if v_city is not null then
    v_city := regexp_replace(
      v_city,
      '\m[A-Z][0-9][A-Z][[:space:]]*[0-9][A-Z][0-9]\M',
      '',
      'gi'
    );
    v_city := regexp_replace(v_city, '\m(ON|Ontario|Canada|CA)\M', '', 'gi');
    v_city := nullif(btrim(regexp_replace(v_city, '[[:space:]]+', ' ', 'g'), ' ,-'), '');
  end if;

  if v_first is null or v_first !~ '^[[:space:]]*[0-9]' then
    return coalesce(v_city, '');
  end if;

  v_street := nullif(
    btrim(regexp_replace(
      v_first,
      '^[[:space:]]*[0-9]+[[:alpha:]]?([[:space:]]*[-/][[:space:]]*[0-9]+[[:alpha:]]?)?[[:space:]]+',
      '',
      'i'
    )),
    ''
  );

  if v_street is null then
    return coalesce(v_city, '');
  end if;

  if v_city is not null then
    return v_street || ', ' || v_city;
  end if;
  return v_street;
end;
$$;

comment on function public.public_address_label(text, text) is
  'Pure SQL mirror used only by public Vacantless RPC payloads that must emit display labels. Portal feed RPCs continue returning the full address.';

-- get_public_listing: recreate the latest 0146 body with address_display_mode.
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
$$;

grant execute on function public.get_public_listing(uuid) to anon, authenticated;

-- get_public_browse_listings: recreate 0168 with address_display_mode for the
-- server-rendered browse surface. The feed/network RPCs are deliberately not
-- changed.
create or replace function public.get_public_browse_listings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'org', jsonb_build_object(
          'name', o.name
        ),
        'listings', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id',               p.id,
              'address',          p.address,
              'address_display_mode', p.address_display_mode,
              'rent_cents',       p.rent_cents,
              'beds',             p.beds,
              'baths',            p.baths,
              'sqft',             p.sqft,
              'floor',            p.floor,
              'laundry',          p.laundry,
              'parking',          p.parking,
              'air_conditioning', p.air_conditioning,
              'balcony',          p.balcony,
              'furnished',        p.furnished,
              'pet_friendly',     p.pet_friendly,
              'pets_cats',        p.pets_cats,
              'pets_dogs',        p.pets_dogs,
              'pets_dog_size',    p.pets_dog_size,
              'pets_notes',       p.pets_notes,
              'heat_included',    p.heat_included,
              'hydro_included',   p.hydro_included,
              'water_included',   p.water_included,
              'available_date',   p.available_date,
              'description',      p.description,
              'virtual_tour_url', p.virtual_tour_url,
              'photos',           coalesce((
                select jsonb_agg(ph.url order by ph.is_cover desc, ph.sort_order asc, ph.created_at asc)
                from public.property_photos ph
                where ph.property_id = p.id
              ), '[]'::jsonb)
            )
            order by p.created_at desc
          )
          from public.properties p
          where p.organization_id = o.id
            and p.status = 'available'
        ), '[]'::jsonb)
      )
      order by o.name asc
    ),
    '[]'::jsonb
  )
  from public.organizations o
  where exists (
    select 1 from public.properties p
    where p.organization_id = o.id
      and p.status = 'available'
  );
$$;

comment on function public.get_public_browse_listings() is
  'Public browse-safe cross-org rental payload for Vacantless-hosted /rentals. Includes address_display_mode so the app can render masked public labels; portal feed RPCs still carry full addresses.';

revoke all on function public.get_public_browse_listings() from public;
revoke all on function public.get_public_browse_listings() from anon;
revoke all on function public.get_public_browse_listings() from authenticated;
grant execute on function public.get_public_browse_listings() to anon;
grant execute on function public.get_public_browse_listings() to authenticated;

-- get_public_leaseup_siblings: recreate 0187 with address_display_mode so the
-- leased-page "available now" suggestions use each sibling's own public setting.
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
      and status not in ('draft', 'off_market')
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
