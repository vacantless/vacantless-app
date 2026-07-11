-- 0129_rental_application_pii_allowlist.sql
-- S459, Codex QA fold (P1): harden the Model-B storage boundary in the anon
-- submit RPC from a top-level, case-SENSITIVE DENYLIST to an ALLOWLIST-only,
-- case-normalized, SCALAR-coerced projection.
--
-- WHY: migration 0125's submit_rental_application stripped only an exact
-- lowercase denylist of sensitive keys (`- 'sin' - 'dob' - ...`). A crafted anon
-- RPC call could still land sensitive data via (a) case variants (`SIN`, `DOB`,
-- `dateOfBirth`), (b) unknown keys the denylist never named (`ssn`,
-- `bank_account`), or (c) NESTED sensitive keys inside an allowed key
-- (`occupants: [{ sin: "..." }]`). Those values then rendered in the operator
-- lead-detail view and the vault print summary — breaking the never-persist
-- guarantee Vacantless makes to applicants.
--
-- FIX: rebuild form_data as a fresh object containing ONLY the known
-- non-sensitive Form-410 keys (mirrors lib/rental-application ALLOWED_FORM_FIELDS),
-- matched case-insensitively (lower(key)), keeping ONLY jsonb SCALAR values
-- (string/number/boolean). Objects and arrays are dropped whole, which removes
-- the nested-key vector; the legitimate Slice-1 form submits every field as a
-- trimmed scalar string (app/apply/[token]/actions.ts), so this is lossless for
-- real submissions. A future slice that needs a structured value must extend
-- this projection deliberately.
--
-- Idempotent (create or replace); no schema/table/RLS change; reversible by
-- re-applying 0125's body. Grants are preserved by create-or-replace and
-- re-affirmed below.

create or replace function public.submit_rental_application(
  p_token          uuid,
  p_form_data      jsonb,
  p_consent        boolean,
  p_applicant_name text,
  p_applicant_email text,
  p_applicant_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.rental_applications%rowtype;
begin
  if p_consent is not true then
    return jsonb_build_object('ok', false, 'reason', 'consent_required');
  end if;

  select * into v_app
  from public.rental_applications
  where public_token = p_token
  for update;
  if v_app.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_app.status <> 'requested' then
    return jsonb_build_object('ok', false, 'reason', 'already_submitted');
  end if;

  update public.rental_applications
     set applicant_name       = coalesce(nullif(btrim(p_applicant_name), ''),  applicant_name),
         applicant_email      = coalesce(nullif(btrim(p_applicant_email), ''), applicant_email),
         applicant_phone      = coalesce(nullif(btrim(p_applicant_phone), ''), applicant_phone),
         applicant_email_norm = lower(nullif(btrim(p_applicant_email), '')),
         -- Model B storage boundary: ALLOWLIST-only, case-normalized, scalars
         -- only. Unknown keys, case-variant sensitive keys, and nested
         -- objects/arrays (where a labelled `sin`/`dob` could hide) are all
         -- dropped. Mirrors lib/rental-application ALLOWED_FORM_FIELDS.
         form_data = coalesce((
           select jsonb_object_agg(lower(e.key), e.value)
           from jsonb_each(coalesce(p_form_data, '{}'::jsonb)) as e
           where lower(e.key) in (
             'current_address','current_duration','current_rent',
             'current_landlord_name','current_landlord_contact','current_reason_leaving',
             'previous_address','previous_duration','previous_landlord_name',
             'previous_landlord_contact','employer','position','employment_length',
             'supervisor_contact','gross_income','second_employer','second_income',
             'other_income','bank_reference_institution','reference_1_name',
             'reference_1_contact','reference_2_name','reference_2_contact',
             'vehicles','occupants','smoking','pets','emergency_contact_name',
             'emergency_contact_phone'
           )
           and jsonb_typeof(e.value) in ('string','number','boolean')
         ), '{}'::jsonb),
         consent_acknowledged_at = now(),
         submitted_at            = now(),
         status                  = 'submitted',
         updated_at              = now()
   where id = v_app.id;

  insert into public.messages (organization_id, lead_id, channel, direction, body)
  values (v_app.organization_id, v_app.lead_id, 'note', 'outbound',
          'Rental application submitted.');

  return jsonb_build_object('ok', true, 'status', 'submitted');
end;
$$;

grant execute on function public.submit_rental_application(uuid, jsonb, boolean, text, text, text)
  to anon, authenticated;
