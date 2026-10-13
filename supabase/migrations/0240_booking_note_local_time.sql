-- S712 new-landlord run: the renter's activity log showed the landlord
-- "Viewing booked ... for 2026-10-14 21:00 UTC". It now reads the org's own
-- viewing time zone: "Wed, Oct 14, 5:00 PM". Anchor patch (WORKFLOW 277).
do $mig$
declare
  v_def text;
  v_old text := $a$to_char(p_slot at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');$a$;
  v_new text := $b$to_char(p_slot at time zone coalesce((select o2.booking_timezone from public.organizations o2 where o2.id = v_org), 'America/Toronto'), 'FMDy, FMMon FMDD, FMHH12:MI AM'));$b$;
begin
  select pg_get_functiondef('public.book_public_showing(uuid,uuid,timestamp with time zone)'::regprocedure) into v_def;
  if position(v_new in v_def) > 0 then
    return; -- already applied
  end if;
  if position(v_old in v_def) = 0 then
    raise exception '0240: anchor not found in book_public_showing';
  end if;
  execute replace(v_def, v_old, v_new);
end
$mig$;
