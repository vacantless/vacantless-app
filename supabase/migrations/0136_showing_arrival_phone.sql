-- 0136 (S471): dedicated operator-editable "showing arrival phone" — the number
-- a renter texts/calls ON ARRIVAL for a booked viewing.
--
-- WHY: today the booking confirmation's call/text line uses
-- organizations.public_contact_phone, which is OVERLOADED — it also feeds the
-- syndication <phone> and the N1/rent-receipt landlordPhone. Blanking it for a
-- feed reason (e.g. Agile S449) silently removed the renter's arrival contact.
-- This decouples them: a dedicated arrival number, operator-set, org-level
-- default with an optional per-property override.
--
-- Additive + backward-compatible: both columns default NULL and the RPC falls
-- back to public_contact_phone, so behaviour is unchanged until an operator sets
-- a value.

alter table public.organizations add column if not exists showing_arrival_phone text;
alter table public.properties    add column if not exists showing_arrival_phone text;

comment on column public.organizations.showing_arrival_phone is
  'Operator-set DEFAULT phone a renter texts/calls on arrival for a booked viewing. Falls back to public_contact_phone when null. Distinct from public_contact_phone (which feeds the syndication feed + N1/receipt).';
comment on column public.properties.showing_arrival_phone is
  'Optional per-property OVERRIDE of organizations.showing_arrival_phone (different building / on-site contact). Falls back to the org default, then public_contact_phone.';

-- Repoint the anon booking-confirmation extras RPC. leasing_phone (the
-- call/text-on-arrival number in the confirmation email) now resolves:
--   property override -> org default -> public_contact_phone.
create or replace function public.get_booking_confirmation_extras(p_property_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'showing_instructions', p.showing_instructions,
    'leasing_phone', coalesce(
        nullif(btrim(p.showing_arrival_phone), ''),
        nullif(btrim(o.showing_arrival_phone), ''),
        o.public_contact_phone
      ),
    'plan', o.plan
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id;
$function$;
