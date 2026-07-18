alter table public.leads
  add column if not exists no_suitable_time boolean not null default false;

drop function if exists public.submit_public_lead(
  uuid, text, text, text, date, text, uuid, integer, integer, boolean, text, jsonb);

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
  p_custom_answers  jsonb   default '[]'::jsonb,
  p_no_suitable_time boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org          uuid;
  v_lead         uuid;
  v_addr         text;
  v_rent         integer;
  v_pet_ok       boolean;
  v_org_name     text;
  v_brand        text;
  v_logo         text;
  v_reply_to     text;
  v_tpl_subj     text;
  v_tpl_body     text;
  v_portal       text;
  v_label        text;
  v_url          text;
  v_post         uuid := null;
  v_source       text := 'website';
  v_source_det   text := null;
  v_optout       boolean := false;
  v_scr_on       boolean;
  v_scr_mult     numeric;
  v_scr_days     integer;
  v_scr_pets     boolean;
  v_rsn_income   text;
  v_rsn_movein   text;
  v_rsn_pets     text;
  v_reasons      text[] := '{}'::text[];
  v_qualout      boolean := false;
  v_custom       jsonb := '[]'::jsonb;
  v_norm_email   text := null;
  v_lead_reused  boolean := false;
  v_lead_has_showing boolean := false;
begin
  select p.organization_id, p.address, p.rent_cents,
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
        when 'rentfaster' then 'RentFaster.ca'
        when 'zumper'     then 'Zumper + PadMapper'
        when 'viewit'     then 'Viewit.ca'
        when 'realtor_ca' then 'Realtor.ca'
        else coalesce(nullif(btrim(v_label), ''), 'Other portal')
      end;
      v_source_det := nullif(btrim(v_url), '');
    end if;
  end if;

  v_norm_email := nullif(lower(btrim(p_email)), '');

  if v_norm_email is not null then
    -- Serialize only the dedupable key. Without this, two identical rapid RPCs
    -- can both check before either insert commits.
    perform pg_advisory_xact_lock(
      hashtext(v_org::text),
      hashtext(p_property_id::text || ':' || v_norm_email)
    );

    select l.id
      into v_lead
    from public.leads l
    where l.organization_id = v_org
      and l.property_id = p_property_id
      and lower(btrim(l.email)) = v_norm_email
      and l.status in ('new', 'replied', 'contacted', 'booked')
      and l.created_at >= now() - interval '10 minutes'
    order by l.created_at asc, l.id asc
    limit 1;

    if v_lead is not null then
      v_lead_reused := true;
      select exists (
        select 1
        from public.showings s
        where s.lead_id = v_lead
          and s.property_id = p_property_id
          and s.outcome = 'scheduled'
      ) into v_lead_has_showing;
    end if;
  end if;

  if not v_lead_reused then
    select exists (
      select 1 from public.leads
      where organization_id = v_org
        and sms_opt_out
        and phone_e164 = public.normalize_phone_e164(p_phone, '1'::text)
    ) into v_optout;

    if v_scr_on then
      if v_scr_mult is not null and v_scr_mult > 0
         and p_income_cents is not null
         and v_rent is not null and v_rent > 0
         and p_income_cents < v_scr_mult * v_rent then
        v_reasons := array_append(
          v_reasons,
          coalesce(nullif(btrim(v_rsn_income), ''), 'Income below your requirement'));
      end if;

      if v_scr_days is not null and p_move_in is not null
         and (p_move_in - current_date) > v_scr_days then
        v_reasons := array_append(
          v_reasons,
          coalesce(nullif(btrim(v_rsn_movein), ''), 'Move-in later than your window'));
      end if;

      if coalesce(v_scr_pets, true) and not coalesce(v_pet_ok, false)
         and p_has_pets is true then
        v_reasons := array_append(
          v_reasons,
          coalesce(nullif(btrim(v_rsn_pets), ''), 'Has pets; rental is not pet-friendly'));
      end if;

      v_qualout := array_length(v_reasons, 1) is not null;

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
                   when 'units' then
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
       qualified_out, qualify_out_reasons, screen_custom_answers, no_suitable_time)
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
       v_custom,
       coalesce(p_no_suitable_time, false))
    returning id into v_lead;

    insert into public.messages
      (organization_id, lead_id, channel, direction, body)
    values
      (v_org, v_lead, 'note', 'inbound',
       'New inquiry via '
         || case when v_post is not null then v_source else 'the public listing page' end
         || case when p_move_in is not null
                 then '. Desired move-in: ' || to_char(p_move_in, 'YYYY-MM-DD')
                 else '' end);
  end if;

  select t.subject, t.body
    into v_tpl_subj, v_tpl_body
  from public.templates t
  where t.organization_id = v_org and t.kind = 'auto_reply'
  order by t.created_at desc
  limit 1;

  return jsonb_build_object(
    'lead_id',          v_lead,
    'lead_reused',      v_lead_reused,
    'lead_has_showing', v_lead_has_showing,
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
  public.submit_public_lead(uuid, text, text, text, date, text, uuid, integer, integer, boolean, text, jsonb, boolean)
  to anon, authenticated;
