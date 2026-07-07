-- ============================================================================
-- 0112_building_key_unit_parenthetical — collapse a triplex entered as N units
-- into ONE building for the owner statement (S433, rent-triage item (d)).
--
-- The problem (KI631, proven on the real 506 Manning triplex): the units were
-- entered as
--     "506 Manning Avenue, Unit 1 (Main), Toronto, ON M6G 2V7"
--     "506 Manning Avenue, Unit 2 (Upper), Toronto, ON M6G 2V7"
--     "506 Manning Avenue, Unit 3 (Lower), Toronto, ON M6G 2V7"
-- The 0049 building_key() function strips the "Unit N" token but NOT the
-- trailing "(Main)/(Upper)/(Lower)" qualifier, so it survives in the street
-- portion and forks ONE physical building into three distinct building_keys.
-- Consequences on the By-building owner statement: (1) a whole-building cost
-- (mortgage / tax / insurance) has no single building to attach to, so it lands
-- in "Unassigned / overhead"; (2) each single-unit building double-rows.
--
-- The fix (surgical, not blunt): extend the unit-token match to OPTIONALLY
-- consume an immediately-following parenthetical, so "Unit 1 (Main)" is treated
-- as one unit designation and fully stripped. A STANDALONE parenthetical that is
-- NOT preceded by a unit token — e.g. a genuinely distinct "123 Main St (North
-- Tower)" — is deliberately left intact, so two real buildings on one lot never
-- merge. Verified against live data: exactly 4 of 29 properties change key (the
-- 3 Manning units collapse to one key + 1 QA leftover); ZERO expenses /
-- work_orders / categorization_rules / org_building_policies reference an old
-- key, so nothing is stranded.
--
-- Mirrored in TS by lib/listing-fill-sheet.splitAddressUnit (same regex change)
-- so the building LABEL on the statement matches the new grouping — the standing
-- "no TS/SQL drift" rule from 0049.
--
-- Mechanics: building_key is a STORED GENERATED column
-- (building_key GENERATED ALWAYS AS (building_key(address)) STORED), so a
-- CREATE OR REPLACE of the function does NOT retroactively recompute the stored
-- values. We force a recompute with a no-op row rewrite (UPDATE ... SET address
-- = address), which keeps the column, its index, and every dependent object in
-- place (no DROP/ADD, no index churn). 29-row table = trivial rewrite.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.building_key(p_address text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(coalesce(p_address, '')),
            -- unit designator + token, plus an OPTIONAL adjacent "(...)" alias
            -- so "unit 1 (main)" strips as a single unit segment.
            '[,[:space:]]*(\y(unit|suite|ste|apt|apartment)\y\.?|#)[[:space:]]*[a-z0-9-]+([[:space:]]*\([^)]*\))?',
            '',
            'g'
          ),
          '[[:space:]]+', ' ', 'g'
        ),
        '(^[[:space:],]+)|([[:space:],]+$)', '', 'g'
      ),
      ' '
    ),
    ''
  );
$function$;

-- Force the STORED generated column to recompute for every existing row.
UPDATE public.properties SET address = address;
