-- 0296_public_sqft_estimated (S799c)
-- The two public listing readers return whether a rental's size is our own
-- estimate (properties.sqft_estimated, 0241), so renter pages can say
-- "about 650 sq ft" instead of stating an estimate as a measured fact.
-- Patches each function's own definition in place (the 0252 pattern): no
-- other line of either function changes. Safe to run twice.
do $mig$
declare
  d text;
  f text;
  hits int;
begin
  foreach f in array array['public.get_public_listing(uuid)', 'public.get_public_browse_listings()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('sqft_estimated' in d) > 0 then
      continue; -- already applied
    end if;
    hits := (length(d) - length(replace(d, 'p.sqft,', ''))) / length('p.sqft,');
    if hits <> 1 then
      raise exception 'S799c: % expected one "p.sqft," anchor, found %; not modified', f, hits;
    end if;
    d := replace(d, 'p.sqft,', 'p.sqft, ''sqft_estimated'', coalesce(p.sqft_estimated, false),');
    execute d;
  end loop;
end
$mig$;
