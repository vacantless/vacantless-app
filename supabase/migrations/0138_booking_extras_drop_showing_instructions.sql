-- 0138 (S474): drop showing_instructions from the anon booking-confirmation
-- extras RPC — CLOSE the agent-only lockbox-notes leak (Codex S471 P1).
--
-- WHY: properties.showing_instructions is AGENT-ONLY (its placeholder is a
-- LOCKBOX CODE). S473 stopped rendering it in the renter booking-confirmation +
-- reminder emails, but get_booking_confirmation_extras is SECURITY DEFINER and
-- granted to anon (0123/0126), so a renter with a public property id could still
-- call the RPC directly and read the access notes. This drops the field from the
-- RPC entirely; the anon path keeps only leasing_phone (arrival contact) + plan
-- (renter-SMS gate) — neither is a secret. showing_instructions now lives ONLY on
-- the authenticated operator + agent-token surfaces (/agent/[token]).
--
-- Additive/reversible (CREATE OR REPLACE); the existing anon+authenticated grant
-- persists and is unchanged.

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
    'plan', o.plan
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id;
$function$;
