-- 0027_brand_gradient.sql
-- Tenant brand can now be a two-stop ombre, not only a solid.
--
-- Adds organizations.brand_color_secondary (nullable). NULL = the tenant brand
-- is a SOLID (brand_color only, unchanged behaviour for every existing org).
-- When set, the brand is an ombre from brand_color -> brand_color_secondary,
-- used for the decorative depth surfaces (header band, icon tiles, accents) on
-- the portal and the public /r + /f pages. Anything with text ON the brand
-- still uses the solid, legibility-guarded brand_color (lib/brand-theme
-- accessibleBrand), so white-on-brand text stays readable; the second stop is
-- decorative only.
--
-- Renter EMAILS are deliberately NOT changed (gradient rendering across mail
-- clients is unreliable), so the email-payload RPCs (submit_public_lead,
-- book_public_showing) keep returning the solid brand_color only. Only the two
-- on-page render RPCs (get_public_listing for /r, get_public_feedback_context
-- for /f) gain the secondary field.

alter table public.organizations
  add column if not exists brand_color_secondary text;

-- ---------------------------------------------------------------------------
-- get_public_listing: byte-for-byte the 0020 body, plus brand_color_secondary.
-- ---------------------------------------------------------------------------
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
    'pet_friendly',     p.pet_friendly,
    'heat_included',    p.heat_included,
    'hydro_included',   p.hydro_included,
    'water_included',   p.water_included,
    'org_name',         o.name,
    'brand_color',      o.brand_color,
    'brand_color_secondary', o.brand_color_secondary,
    'logo_url',         o.logo_url,
    'photos',           coalesce((
      select jsonb_agg(ph.url order by ph.is_cover desc, ph.sort_order asc, ph.created_at asc)
      from public.property_photos ph
      where ph.property_id = p.id
    ), '[]'::jsonb)
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id
    and p.status not in ('off_market', 'draft');
$$;

grant execute on function public.get_public_listing(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_public_feedback_context: byte-for-byte the 0009 body, plus the secondary.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_feedback_context(
  p_showing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_name   text;
  v_brand      text;
  v_brand2     text;
  v_logo       text;
  v_addr       text;
  v_renter     text;
  v_outcome    text;
  v_done       boolean;
begin
  select o.name, o.brand_color, o.brand_color_secondary, o.logo_url, p.address, l.name, s.outcome
    into v_org_name, v_brand, v_brand2, v_logo, v_addr, v_renter, v_outcome
  from public.showings s
  join public.organizations o on o.id = s.organization_id
  left join public.properties p on p.id = s.property_id
  left join public.leads l on l.id = s.lead_id
  where s.id = p_showing_id;

  if v_org_name is null then
    return null;
  end if;

  select exists (
    select 1 from public.feedback f where f.showing_id = p_showing_id
  ) into v_done;

  return jsonb_build_object(
    'showing_id',       p_showing_id,
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'brand_color_secondary', v_brand2,
    'logo_url',         v_logo,
    'property_address', v_addr,
    'renter_name',      v_renter,
    'already_submitted', v_done
  );
end;
$$;

grant execute on function public.get_public_feedback_context(uuid)
  to anon, authenticated;
