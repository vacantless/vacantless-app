-- S710 (audit, Noam approved): the same renter showed up twice on one rental.
-- Agile, Bruce 303: Yash Patel, Lovinger Yamoah, Kacy Nero; Assumption 9:
-- Bansee Patel. Each first wrote on Facebook Marketplace (lead saved then),
-- then booked days later through the booking link, which made a SECOND lead.
-- submit_public_lead only reused a lead from the last 10 minutes.
-- Fix: before inserting, look for an open lead on the SAME rental with the
-- same email or phone from the last 60 days. If found, attach to it: fill
-- blanks, refresh the screening answers the renter just gave, add a note,
-- and return lead_returning=true. lead_reused stays false, so the landlord is
-- still told and the renter still gets the reply. A different rental still
-- makes a new lead (a renter asking about two units is two enquiries).
-- Patched by anchors, like 0230, so the rest of the function is untouched.
do $mig$
declare
  v_sig text := 'public.submit_public_lead(uuid,text,text,text,date,text,uuid,integer,integer,boolean,text,jsonb,boolean,text,text,text)';
  v_def text;
  a_decl text := E'  v_lead_has_showing boolean := false;\n';
  a_ins  text := E'    insert into public.leads\n      (organization_id, property_id, name, email, phone, move_in,\n';
  a_end  text := E'  end if;\n\n  select t.subject, t.body\n';
  a_ret  text := E'    ''lead_has_showing'', v_lead_has_showing,\n';
  p_block text;
begin
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if position('v_lead_returning' in v_def) > 0 then
    raise notice '0238 already applied';
    return;
  end if;
  if position(a_decl in v_def) = 0 then raise exception '0238 anchor decl not found'; end if;
  if position(a_ins in v_def) = 0 then raise exception '0238 anchor insert not found'; end if;
  if position(a_end in v_def) = 0 then raise exception '0238 anchor end not found'; end if;
  if position(a_ret in v_def) = 0 then raise exception '0238 anchor return not found'; end if;

  p_block :=
       E'    -- S710: same renter, same rental, still open, last 60 days: attach.\n'
    || E'    select l.id into v_lead\n'
    || E'    from public.leads l\n'
    || E'    where l.organization_id = v_org\n'
    || E'      and l.property_id = p_property_id\n'
    || E'      and l.status in (''new'', ''replied'', ''contacted'', ''booked'', ''showed'', ''applied'')\n'
    || E'      and l.created_at >= now() - interval ''60 days''\n'
    || E'      and ((v_norm_email is not null and lower(btrim(l.email)) = v_norm_email)\n'
    || E'        or (public.normalize_phone_e164(p_phone, ''1''::text) is not null\n'
    || E'            and l.phone_e164 = public.normalize_phone_e164(p_phone, ''1''::text)))\n'
    || E'    order by l.created_at desc, l.id desc\n'
    || E'    limit 1;\n'
    || E'\n'
    || E'    if v_lead is not null then\n'
    || E'      v_lead_returning := true;\n'
    || E'      update public.leads l set\n'
    || E'        email = coalesce(nullif(btrim(l.email), ''''), nullif(btrim(p_email), '''')),\n'
    || E'        phone = coalesce(nullif(btrim(l.phone), ''''), nullif(btrim(p_phone), '''')),\n'
    || E'        move_in = coalesce(l.move_in, p_move_in),\n'
    || E'        screen_income_cents = coalesce(p_income_cents, l.screen_income_cents),\n'
    || E'        screen_occupants = coalesce(p_occupants, l.screen_occupants),\n'
    || E'        screen_has_pets = coalesce(p_has_pets, l.screen_has_pets),\n'
    || E'        screen_pets_detail = coalesce(nullif(btrim(p_pets_detail), ''''), l.screen_pets_detail),\n'
    || E'        screen_custom_answers = case when jsonb_array_length(coalesce(v_custom, ''[]''::jsonb)) > 0\n'
    || E'                                     then v_custom else l.screen_custom_answers end,\n'
    || E'        qualified_out = coalesce(l.qualified_out, false) or v_qualout,\n'
    || E'        qualify_out_reasons = case when v_qualout then v_reasons else l.qualify_out_reasons end,\n'
    || E'        no_suitable_time = coalesce(l.no_suitable_time, false) or coalesce(p_no_suitable_time, false),\n'
    || E'        sms_opt_out = l.sms_opt_out or v_optout,\n'
    || E'        sms_opt_out_at = case when l.sms_opt_out then l.sms_opt_out_at\n'
    || E'                              when v_optout then now() else l.sms_opt_out_at end\n'
    || E'      where l.id = v_lead;\n'
    || E'\n'
    || E'      insert into public.messages\n'
    || E'        (organization_id, lead_id, channel, direction, body)\n'
    || E'      values\n'
    || E'        (v_org, v_lead, ''note'', ''inbound'',\n'
    || E'         ''Wrote again via ''\n'
    || E'           || case when v_post is not null then v_source else ''the public listing page'' end\n'
    || E'           || ''. Same renter, so this stays on one record.'');\n'
    || E'\n'
    || E'      select exists (\n'
    || E'        select 1 from public.showings s\n'
    || E'        where s.lead_id = v_lead and s.property_id = p_property_id\n'
    || E'          and s.outcome = ''scheduled''\n'
    || E'      ) into v_lead_has_showing;\n'
    || E'    else\n'
    || a_ins;

  v_def := replace(v_def, a_decl, a_decl || E'  v_lead_returning boolean := false;\n');
  v_def := replace(v_def, a_ins, p_block);
  v_def := replace(v_def, a_end, E'    end if;\n' || a_end);
  v_def := replace(v_def, a_ret, a_ret || E'    ''lead_returning'',   v_lead_returning,\n');
  execute v_def;
end
$mig$;
