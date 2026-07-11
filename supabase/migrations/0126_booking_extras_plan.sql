-- 0126_booking_extras_plan.sql
-- S454, Codex P2 fold: renter-SMS plan gate.
--
-- get_booking_confirmation_extras is the SECURITY DEFINER RPC the anon booking
-- path calls to fetch renter-facing confirmation extras (it already joins
-- organizations). Add the org `plan` to its return so the booking action can
-- enforce canUseRenterSms(plan) before sending a booking-confirmation SMS —
-- closing the gap where the "Free = no texting" claim wasn't enforced at the
-- send site (only sms_enabled was checked). Backward-compatible: the JSON gains
-- a field; existing consumers ignore it. Reversible (CREATE OR REPLACE).

create or replace function public.get_booking_confirmation_extras(
  p_property_id uuid
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'showing_instructions', p.showing_instructions,
    'leasing_phone',        o.public_contact_phone,
    'plan',                 o.plan
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id;
$$;

grant execute on function public.get_booking_confirmation_extras(uuid)
  to anon, authenticated;
