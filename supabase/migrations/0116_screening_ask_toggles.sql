-- ===========================================================================
-- 0116_screening_ask_toggles — per-built-in "ask this question" toggles (S438 Slice 2)
--
-- S438 Slice 1 made the pre-screening page legible (asked vs auto-flagged). This
-- slice adds the one deferred capability: turn each BUILT-IN question (income,
-- move-in, pets, occupants) on/off for the renter form independently of whether
-- its answer auto-flags. Today the built-ins render as a fixed set; this lets an
-- operator suppress one it doesn't want to ask.
--
-- Two additive pieces, no destructive change:
--   1. organizations: 4 booleans, DEFAULT true, so every existing org keeps the
--      current behavior (all built-ins asked). NOT NULL default true.
--   2. get_public_listing: emit the 4 flags so the public form knows which
--      built-in fieldsets to render. Recreated from 0071 with 4 added keys;
--      everything else byte-identical. CREATE OR REPLACE (signature unchanged).
--
-- submit_public_lead is deliberately UNTOUCHED: a suppressed question is simply
-- never submitted, so its answer arrives null and the existing evaluator already
-- never flags a missing answer (KI: missing answers never flag). The stored flag
-- threshold stays inert on its own — no flag-logic change is needed or made.
--
-- Backward-compatible with the currently-deployed app: it ignores the new keys
-- and renders every built-in (matching default true), so ordering is not
-- sensitive. The pure mirror is lib/screening.ts (OrgScreeningConfig +
-- describeScreeningStatus honor the flags).
-- ===========================================================================

-- 1) organizations: per-built-in ask toggles ---------------------------------
alter table public.organizations
  add column if not exists screening_ask_income    boolean not null default true,
  add column if not exists screening_ask_movein    boolean not null default true,
  add column if not exists screening_ask_pets      boolean not null default true,
  add column if not exists screening_ask_occupants boolean not null default true;

comment on column public.organizations.screening_ask_income is
  'S438 Slice 2: ask the built-in income question on the renter form. Default true.';
comment on column public.organizations.screening_ask_movein is
  'S438 Slice 2: ask the built-in move-in-date question on the renter form. Default true.';
comment on column public.organizations.screening_ask_pets is
  'S438 Slice 2: ask the built-in pets question on the renter form. Default true.';
comment on column public.organizations.screening_ask_occupants is
  'S438 Slice 2: ask the built-in occupants question on the renter form. Default true.';

-- 2) get_public_listing — recreated from 0071 with 4 added keys
--    (screening_ask_income/movein/pets/occupants). Everything else is
--    byte-identical to 0071. CREATE OR REPLACE (signature unchanged).
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
    -- S438 Slice 2: per-built-in ask toggles. The public form renders the income /
    -- move-in / pets / occupants fieldset only when the matching flag is true.
    -- Default true, so a pre-Slice-2 org keeps every built-in.
    'screening_ask_income',    o.screening_ask_income,
    'screening_ask_movein',    o.screening_ask_movein,
    'screening_ask_pets',      o.screening_ask_pets,
    'screening_ask_occupants', o.screening_ask_occupants,
    -- Operator-authored questions (S291). Empty unless screening is enabled, so
    -- the public page only renders custom questions where the built-in fieldset
    -- already shows. Ordered by position then created_at. S294 adds 'choices'
    -- (empty array for text/yesno). S331: a 'units' question emits the org's OTHER
    -- available units' addresses as its choices (dynamic, available-only) so the
    -- form can render the picker; if there are none, it emits an empty array and
    -- the form omits the question.
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
