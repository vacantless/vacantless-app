-- ============================================================================
-- 0123_booking_confirmation_extras (S448)
--
-- The renter booking-confirmation email is upgraded (lib/email.ts) to carry the
-- unit's access notes + a call/text-if-late number. The public /r booking path
-- runs as anon, which can't read properties.showing_instructions or
-- organizations.public_contact_phone directly (RLS). Rather than modify the
-- large, critical book_public_showing RPC, this adds a tiny, isolated read-only
-- SECURITY DEFINER helper the booking action calls after a successful book.
--
-- Returns NULL for an unknown property; both fields may be null (rendered
-- conditionally in the email). Reversible: drop function.
-- ============================================================================
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
    'leasing_phone',        o.public_contact_phone
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id;
$$;

grant execute on function public.get_booking_confirmation_extras(uuid)
  to anon, authenticated;
