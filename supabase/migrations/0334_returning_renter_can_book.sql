-- S841h: a returning renter could never book a viewing.
--
-- submit_public_lead (S710) attaches a renter who writes again within 60 days
-- to their existing record. book_public_showing still required the record to
-- be "freshly created" (under 15 minutes old), so every booking by a returning
-- renter raised "Booking not allowed", which the page shows as "That time was
-- just taken". Found 2026-11-25 from a renter's text on Agile: "I tried every
-- time... each one says someone else just took it". 122 public bookings on
-- file, every one within 11 seconds of the record being made; none later.
--
-- The 15-minute rule stays as the guard against booking on an old record id.
-- A record now also qualifies when submit_public_lead itself wrote its
-- "Wrote again via ..." note on it in the last 15 minutes. Only that function
-- (security definer) and signed-in staff can write messages; a signed-out
-- visitor cannot (no grant, row security on).
--
-- Written as an exact patch of the live function so no other line can drift.
-- Additive: create or replace only.

do $$
declare
  v_def text;
  v_old constant text := $q$and l.created_at > now() - interval '15 minutes';$q$;
  v_new constant text := $q$and (l.created_at > now() - interval '15 minutes'
         -- S841h: or the renter just wrote again and was attached to this record.
         or exists (
           select 1 from public.messages m
           where m.lead_id = l.id
             and m.channel = 'note'
             and m.direction = 'inbound'
             and m.body like 'Wrote again via %'
             and m.created_at > now() - interval '15 minutes'));$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'book_public_showing';

  if v_def is null then
    raise exception '0334: book_public_showing not found';
  end if;
  if position('S841h' in v_def) > 0 then
    raise notice '0334: already applied';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception '0334: the 15-minute line was not found exactly once';
  end if;

  execute replace(v_def, v_old, v_new);
end
$$;
