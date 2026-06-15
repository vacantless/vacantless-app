-- ============================================================================
-- ONE-OFF cleanup: remove the S167 throwaway verification data.
-- Run once in the Supabase SQL editor. NOT a migration (do not keep re-running).
-- ============================================================================
-- Removes the smoke-test org "Smoke Test Realty S167" and everything cascading
-- from it (its property "120 Dunlop", lead "Jordan Tenant", messages), then the
-- throwaway auth user. Safe: scoped by the org name + the test email only.
-- ============================================================================

-- 1. Delete the test org. FK cascades drop its memberships, properties, leads,
--    showings, messages, templates, feedback.
delete from public.organizations
where name = 'Smoke Test Realty S167';

-- 2. Delete the throwaway auth user (created during the S166 signup smoke-test).
--    Deleting from auth.users cascades to any remaining membership rows.
delete from auth.users
where email = 'smoketest-s167@example.com';

-- 3. Verify nothing test-flavoured remains (expect 0 rows from each).
select 'orgs'  as what, count(*) from public.organizations where name ilike '%smoke test%'
union all
select 'users' as what, count(*) from auth.users        where email = 'smoketest-s167@example.com';
