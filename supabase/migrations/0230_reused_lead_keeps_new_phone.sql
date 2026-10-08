-- S702: a renter who sends an enquiry and then books within 10 minutes reuses
-- the first lead row (submit_public_lead dedupe). The reuse branch ignored every
-- new field, so a phone typed only at booking was dropped and the booking
-- confirmation text never went out (found on the S702 stranger walk).
-- Fix: on reuse, fill blanks only (phone, move-in). Never overwrite a value the
-- renter already gave. If the newly added phone belongs to someone who texted
-- STOP in this org, the lead inherits the opt-out (same rule as a new lead).
-- Applied to prod 2026-10-08 via apply_migration; verified by a fresh
-- enquiry-then-booking (lead c350c613 kept the phone, booking text sent).
do $mig$
declare
  v_def text;
  v_anchor text := E'    if v_lead is not null then\n      v_lead_reused := true;\n';
  v_patch text := E'    if v_lead is not null then\n      v_lead_reused := true;\n'
    || E'      update public.leads l\n'
    || E'         set phone = nullif(btrim(p_phone), ''''),\n'
    || E'             sms_opt_out = l.sms_opt_out or exists (\n'
    || E'               select 1 from public.leads o\n'
    || E'               where o.organization_id = v_org and o.sms_opt_out\n'
    || E'                 and o.phone_e164 = public.normalize_phone_e164(p_phone, ''1''::text)),\n'
    || E'             sms_opt_out_at = case when l.sms_opt_out then l.sms_opt_out_at\n'
    || E'               when exists (select 1 from public.leads o\n'
    || E'                 where o.organization_id = v_org and o.sms_opt_out\n'
    || E'                   and o.phone_e164 = public.normalize_phone_e164(p_phone, ''1''::text))\n'
    || E'               then now() else l.sms_opt_out_at end\n'
    || E'       where l.id = v_lead\n'
    || E'         and nullif(btrim(l.phone), '''') is null\n'
    || E'         and nullif(btrim(p_phone), '''') is not null;\n'
    || E'      update public.leads l set move_in = p_move_in\n'
    || E'       where l.id = v_lead and l.move_in is null and p_move_in is not null;\n';
begin
  v_def := pg_get_functiondef('public.submit_public_lead(uuid,text,text,text,date,text,uuid,integer,integer,boolean,text,jsonb,boolean,text,text,text)'::regprocedure);
  if position(v_anchor in v_def) = 0 then
    raise exception 'S702 anchor not found in submit_public_lead';
  end if;
  if position('set phone = nullif(btrim(p_phone)' in v_def) > 0 then
    raise notice 'already patched';
    return;
  end if;
  execute replace(v_def, v_anchor, v_patch);
end
$mig$;
