-- 0130_rental_application_form_data_backfill.sql
-- S459 Codex re-review (P1 completion): 0129 hardened only FUTURE anon submits.
-- This scrubs any rows written BEFORE 0129 so stored rental_applications.form_data
-- cannot retain case-variant / unknown / nested sensitive keys. Same allowlist +
-- scalar projection as the 0129 submit RPC. Idempotent: a clean row is unchanged
-- (the `is distinct from` guard skips no-op writes). At apply time prod had 0
-- rental_applications rows; this is the defense-in-depth close so the Model-B
-- boundary holds for any row in any environment, past or future.

update public.rental_applications ra
   set form_data = coalesce((
         select jsonb_object_agg(lower(e.key), e.value)
         from jsonb_each(ra.form_data) as e
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
       updated_at = now()
 where ra.form_data is not null
   and ra.form_data <> '{}'::jsonb
   and ra.form_data is distinct from coalesce((
         select jsonb_object_agg(lower(e.key), e.value)
         from jsonb_each(ra.form_data) as e
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
       ), '{}'::jsonb);
