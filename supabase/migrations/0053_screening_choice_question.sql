-- ===========================================================================
-- 0053_screening_choice_question — single-select 'choice' question type (S294)
--
-- Follow-on to 0051 (custom pre-screening questions) and 0052 (preferred-answer
-- soft flag). Adds a third question type beyond 'text' and 'yesno': 'choice', a
-- single-select from an operator-defined option list. Like 'text', it is
-- INFORMATIONAL ONLY — a choice answer is captured + shown on the lead but never
-- drives qualified_out, and (unlike 'yesno') it carries NO preferred-answer soft
-- flag. Wiring an operator-defined "preferred option" to a soft flag re-opens
-- the fair-housing question, so it is deliberately out of scope here; the
-- preferred_answer column (0052) stays yes/no-only.
--
-- Two additive pieces, no destructive data change:
--   1. org_screening_questions: relax the qtype check to include 'choice'; add a
--      choices text[] column (the option list; '{}' for text/yesno).
--   2. get_public_listing: emit each question's choices so the public form can
--      render the select (CREATE OR REPLACE — signature unchanged).
--   3. submit_public_lead: snapshot a choice answer ONLY when it exactly matches
--      one of the question's stored options (the anon-RPC-re-validate rule — the
--      renter cannot smuggle a value that was never an option). Same 12-arg
--      signature as 0052, so CREATE OR REPLACE works — no DROP needed.
--
-- The pure mirror is lib/screening-questions.ts (normalizeChoices /
-- parseCustomAnswer / buildAnswerSnapshot); the normalization here matches it
-- (choice answer kept only when `= any(choices)`).
-- ===========================================================================

-- 1) org_screening_questions: allow 'choice' + add the options column ----------
-- The 0051 inline check was named org_screening_questions_qtype_check by Postgres.
-- Drop-if-exists then re-add so the migration is idempotent and name-stable.
alter table public.org_screening_questions
  drop constraint if exists org_screening_questions_qtype_check;
alter table public.org_screening_questions
  add constraint org_screening_questions_qtype_check
    check (qtype in ('text', 'yesno', 'choice'));

alter table public.org_screening_questions
  add column if not exists choices text[] not null default '{}'::text[];

comment on column public.org_screening_questions.qtype is
  'text = free-text; yesno = yes/no; choice = single-select from `choices` (S294).';
comment on column public.org_screening_questions.choices is
  'Option list for a choice question (S294). Empty for text/yesno. The renter answer is kept only when it exactly matches one of these.';

-- 2) get_public_listing — recreated from 0051 with one added key per question,
--    'choices'. Everything else is byte-identical to 0051 (0052 did not touch it).
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
    -- Operator-authored questions (S291). Empty unless screening is enabled, so
    -- the public page only renders custom questions where the built-in fieldset
    -- already shows. Ordered by position then created_at. S294 adds 'choices'
    -- (empty array for text/yesno) so a choice question can render its options.
    'screening_questions', case when o.screening_enabled then coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',       q.id,
                 'prompt',   q.prompt,
                 'qtype',    q.qtype,
                 'required', q.required,
                 'choices',  to_jsonb(q.choices))
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

-- 3) submit_public_lead — recreated from 0052 (same 12-arg signature, so
--    CREATE OR REPLACE; no DROP). The ONLY change vs 0052 is the 'choice' branch
--    in the custom-answer normalization lateral: a choice answer is kept only
--    when it is exactly one of the question's stored options.
-- ---------------------------------------------------------------------------
create or replace function public.submit_public_lead(
  p_property_id     uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_move_in         date,
  p_notes           text,
  p_listing_post_id uuid    default null,
  p_income_cents    integer default null,
  p_occupants       integer default null,
  p_has_pets        boolean default null,
  p_pets_detail     text    default null,
  p_custom_answers  jsonb   default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org        uuid;
  v_lead       uuid;
  v_addr       text;
  v_rent       integer;
  v_pet_ok     boolean;
  v_org_name   text;
  v_brand      text;
  v_logo       text;
  v_reply_to   text;
  v_tpl_subj   text;
  v_tpl_body   text;
  v_portal     text;
  v_label      text;
  v_url        text;
  v_post       uuid := null;
  v_source     text := 'website';
  v_source_det text := null;
  v_optout     boolean := false;
  -- screening config + computed result
  v_scr_on     boolean;
  v_scr_mult   numeric;
  v_scr_days   integer;
  v_scr_pets   boolean;
  v_rsn_income text;
  v_rsn_movein text;
  v_rsn_pets   text;
  v_reasons    text[] := '{}'::text[];
  v_qualout    boolean := false;
  -- custom-question answer snapshot (S291)
  v_custom     jsonb := '[]'::jsonb;
begin
  select p.organization_id, p.address, p.rent_cents,
         -- RESOLVED pet_friendly (unit > building > org), 0050.
         (coalesce(p.pets_cats, bp.policy_pets_cats, o.policy_pets_cats, false)
           or coalesce(p.pets_dogs, bp.policy_pets_dogs, o.policy_pets_dogs, false)),
         o.name, o.brand_color, o.logo_url, o.reply_to_email,
         o.screening_enabled, o.screening_income_multiple,
         o.screening_max_movein_days, o.screening_flag_pets,
         o.screening_reason_income, o.screening_reason_movein,
         o.screening_reason_pets
    into v_org, v_addr, v_rent, v_pet_ok,
         v_org_name, v_brand, v_logo, v_reply_to,
         v_scr_on, v_scr_mult, v_scr_days, v_scr_pets,
         v_rsn_income, v_rsn_movein, v_rsn_pets
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  left join public.org_building_policies bp
    on bp.organization_id = p.organization_id
   and bp.building_key = p.building_key
  where p.id = p_property_id and p.status = 'available';

  if v_org is null then
    raise exception 'Listing not available';
  end if;

  -- Resolve the tracked post, but only if it genuinely belongs to THIS
  -- property (and therefore this org). A bad/foreign id silently falls back to
  -- the plain 'website' source - it can never attach a lead to another unit.
  if p_listing_post_id is not null then
    select lp.id, lp.portal, lp.label, lp.url
      into v_post, v_portal, v_label, v_url
    from public.listing_posts lp
    where lp.id = p_listing_post_id
      and lp.property_id = p_property_id;

    if v_post is not null then
      v_source := case v_portal
        when 'kijiji'     then 'Kijiji'
        when 'facebook'   then 'Facebook Marketplace'
        when 'rentals_ca' then 'Rentals.ca'
        when 'zumper'     then 'Zumper'
        when 'viewit'     then 'Viewit.ca'
        when 'realtor_ca' then 'Realtor.ca'
        else coalesce(nullif(btrim(v_label), ''), 'Other portal')
      end;
      v_source_det := nullif(btrim(v_url), '');
    end if;
  end if;

  -- Inherit a prior STOP for this number in this org: if any existing lead with
  -- the same normalized phone has opted out, the new lead is born opted out so
  -- no SMS (confirmation OR reminder) is ever sent without a fresh START.
  select exists (
    select 1 from public.leads
    where organization_id = v_org
      and sms_opt_out
      and phone_e164 = public.normalize_phone_e164(p_phone, '1'::text)
  ) into v_optout;

  -- Candidate pre-screening (mirrors lib/screening.ts evaluateScreening). Only
  -- runs when the org opted in; missing answers never cause a flag. The reason
  -- wording is the org override coalesced over the canonical default
  -- (resolveScreeningReason) and is snapshotted into the lead.
  if v_scr_on then
    -- Income: monthly income below (multiple x monthly rent).
    if v_scr_mult is not null and v_scr_mult > 0
       and p_income_cents is not null
       and v_rent is not null and v_rent > 0
       and p_income_cents < v_scr_mult * v_rent then
      v_reasons := array_append(
        v_reasons,
        coalesce(nullif(btrim(v_rsn_income), ''), 'Income below your requirement'));
    end if;

    -- Move-in timing: desired move-in further out than the configured window.
    if v_scr_days is not null and p_move_in is not null
       and (p_move_in - current_date) > v_scr_days then
      v_reasons := array_append(
        v_reasons,
        coalesce(nullif(btrim(v_rsn_movein), ''), 'Move-in later than your window'));
    end if;

    -- Pets: has pets, unit is not pet-friendly (resolved policy).
    if coalesce(v_scr_pets, true) and not coalesce(v_pet_ok, false)
       and p_has_pets is true then
      v_reasons := array_append(
        v_reasons,
        coalesce(nullif(btrim(v_rsn_pets), ''), 'Has pets; rental is not pet-friendly'));
    end if;

    v_qualout := array_length(v_reasons, 1) is not null;

    -- Custom-question answers (S291/S293/S294). RE-FETCH the org's active
    -- questions and snapshot only answers that map to a real question, normalized
    -- by type:
    --   yes-no -> 'yes'/'no' else dropped
    --   text   -> trimmed + clamped to 500 else dropped
    --   choice -> kept only when it exactly matches one of q.choices, else dropped
    -- Mirrors parseCustomAnswer/buildAnswerSnapshot in lib/screening-questions.ts.
    -- INFORMATIONAL: deliberately does NOT touch v_reasons / v_qualout.
    --
    -- S293: each yes/no object also carries the operator's `preferred` answer at
    -- intake (only when set), merged in so a no-preference question keeps the
    -- pre-S293 {question_id,prompt,qtype,answer} shape exactly. choice carries no
    -- preferred (yes/no-only). The preference is a SNAPSHOT; the soft mismatch is
    -- computed at display (isPreferenceMismatch) and never affects qualified_out.
    select coalesce(jsonb_agg(x.obj order by x.position asc, x.created_at asc), '[]'::jsonb)
      into v_custom
    from (
      select q.position, q.created_at,
        jsonb_build_object(
          'question_id', q.id,
          'prompt',      q.prompt,
          'qtype',       q.qtype,
          'answer',      norm.answer)
        || case when q.qtype = 'yesno' and q.preferred_answer is not null
                then jsonb_build_object('preferred', q.preferred_answer)
                else '{}'::jsonb end as obj
      from public.org_screening_questions q
      join lateral (
        select case q.qtype
                 when 'yesno' then
                   case lower(btrim(a.elem->>'answer'))
                     when 'yes' then 'yes' when 'no' then 'no' else null end
                 when 'text' then
                   nullif(left(btrim(a.elem->>'answer'), 500), '')
                 when 'choice' then
                   case when btrim(a.elem->>'answer') = any(q.choices)
                        then btrim(a.elem->>'answer') else null end
                 else null
               end as answer
        from jsonb_array_elements(coalesce(p_custom_answers, '[]'::jsonb)) a(elem)
        where (a.elem->>'question_id') = q.id::text
        limit 1
      ) norm on true
      where q.organization_id = v_org
        and q.active
        and norm.answer is not null
    ) x;
  end if;

  insert into public.leads
    (organization_id, property_id, name, email, phone, move_in,
     source, source_detail, listing_post_id, status, notes,
     sms_opt_out, sms_opt_out_at,
     screen_income_cents, screen_occupants, screen_has_pets, screen_pets_detail,
     qualified_out, qualify_out_reasons, screen_custom_answers)
  values
    (v_org, p_property_id,
     nullif(btrim(p_name), ''),
     nullif(btrim(p_email), ''),
     nullif(btrim(p_phone), ''),
     p_move_in,
     v_source, v_source_det, v_post, 'new',
     nullif(btrim(p_notes), ''),
     v_optout,
     case when v_optout then now() else null end,
     p_income_cents,
     p_occupants,
     p_has_pets,
     nullif(btrim(p_pets_detail), ''),
     v_qualout,
     v_reasons,
     v_custom)
  returning id into v_lead;

  -- Inbound activity note for the timeline. Mentions the channel when known.
  insert into public.messages
    (organization_id, lead_id, channel, direction, body)
  values
    (v_org, v_lead, 'note', 'inbound',
     'New inquiry via '
       || case when v_post is not null then v_source else 'the public listing page' end
       || case when p_move_in is not null
               then '. Desired move-in: ' || to_char(p_move_in, 'YYYY-MM-DD')
               else '' end);

  -- Most-recent auto_reply template for this org, if the operator made one.
  select t.subject, t.body
    into v_tpl_subj, v_tpl_body
  from public.templates t
  where t.organization_id = v_org and t.kind = 'auto_reply'
  order by t.created_at desc
  limit 1;

  return jsonb_build_object(
    'lead_id',          v_lead,
    'org_id',           v_org,
    'renter_name',      nullif(btrim(p_name), ''),
    'renter_email',     nullif(btrim(p_email), ''),
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'logo_url',         v_logo,
    'reply_to_email',   v_reply_to,
    'property_address', v_addr,
    'rent_cents',       v_rent,
    'template_subject', v_tpl_subj,
    'template_body',    v_tpl_body
  );
end;
$$;

grant execute on function
  public.submit_public_lead(uuid, text, text, text, date, text, uuid, integer, integer, boolean, text, jsonb)
  to anon, authenticated;
