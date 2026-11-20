-- 0315_renter_arrival_note.sql
-- S824f: a renter-safe arrival note per rental ("Buzz 20, park in visitor
-- spots"). Renters who book see it in the confirmation, reminders and day-of
-- texts. Lockbox and door codes stay in showing_instructions (agent only);
-- the app refuses a note that reads like a code.
-- get_booking_confirmation_extras: the live body, plus 'arrival_note'.

alter table public.properties
  add column if not exists renter_arrival_note text
    check (renter_arrival_note is null or char_length(renter_arrival_note) <= 300);

create or replace function public.get_booking_confirmation_extras(p_property_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'leasing_phone', coalesce(
        nullif(btrim(p.showing_arrival_phone), ''),
        nullif(btrim(o.showing_arrival_phone), ''),
        o.public_contact_phone
      ),
    'arrival_note', nullif(btrim(p.renter_arrival_note), ''),
    'plan', o.plan,
    'mail_alias', o.mail_alias,
    'booking_requires_confirmation', coalesce(p.viewing_requires_confirmation, o.booking_requires_confirmation)
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id;
$function$;
