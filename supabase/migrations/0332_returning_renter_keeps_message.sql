-- 0332 (S840, Noam 2026-11-24): a renter who writes again keeps what they wrote.
--
-- 0238 put a returning renter's new submission on their existing lead with a
-- note "Wrote again via <site>. Same renter, so this stays on one record." but
-- dropped what they typed and the times that suit them (p_notes carries both,
-- app/r/[propertyId]/actions.ts notesWithAvailability). On 2026-11-24 three
-- Agile renters pressed "Can't make these times?" 2 or 3 times each after the
-- 8:00 reopen text, and the record showed none of it.
--
-- Same method as 0238: read the live function, replace one exact line, run it.
-- CREATE OR REPLACE keeps the function's grants. Additive: no drop.
-- APPLIED 2026-11-24 ~16:00 on Noam's go; proven by a rolled-back call on
-- Lakeview 100 (second send saved "They wrote: ..." on the same lead).
do $mig$
declare
  v_def text;
  a_line text := $a$           || '. Same renter, so this stays on one record.');$a$;
  b_line text := $b$           || '. Same renter, so this stays on one record.'
           || coalesce(chr(10) || chr(10) || 'They wrote: ' || nullif(btrim(p_notes), ''), ''));$b$;
begin
  v_def := pg_get_functiondef(
    'public.submit_public_lead(uuid,text,text,text,date,text,uuid,integer,integer,boolean,text,jsonb,boolean,text,text,text)'::regprocedure
  );
  if position('They wrote: ' in v_def) > 0 then
    raise notice '0332: already applied';
    return;
  end if;
  if position(a_line in v_def) = 0 then
    raise exception '0332: the Wrote again line was not found; submit_public_lead changed since 0238';
  end if;
  v_def := replace(v_def, a_line, b_line);
  execute v_def;
end
$mig$;
