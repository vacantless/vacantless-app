-- S669: make the spend ledger genuinely append-only for the app's own role.
--
-- 0217 created public.distribution_channel_spend as an append-only audit ledger and
-- granted service_role SELECT + INSERT, but its revokes named only anon and
-- authenticated. The Supabase project default already grants service_role ALL on
-- tables in public, so service_role kept TRUNCATE: the one role that writes the
-- ledger could also erase it. An audit trail its own writer can wipe is not an
-- audit trail.
--
-- SCOPE NOTE, read this before generalising. service_role can TRUNCATE all 94 tables
-- in public [verified 2026-08-20 via information_schema.role_table_grants]. This
-- migration deliberately fixes exactly ONE table, the audit ledger, where erasability
-- defeats the table's whole purpose. It is NOT a project-wide hardening pass and must
-- not be reported as one. Do not "restore consistency" by granting TRUNCATE back here.
--
-- Verified safe at apply time [2026-08-20]: the ledger has 0 rows and 0 user triggers,
-- nothing writes it yet (the ledger is unwired scaffolding, see 0217), and there is no
-- TRUNCATE statement anywhere in app/, lib/, scripts/ or supabase/ at main 0ff62d1.
--
-- Reversal, one line, if this ever breaks anything:
--   grant truncate on public.distribution_channel_spend to service_role;

revoke truncate on public.distribution_channel_spend from service_role;

-- Re-affirm the intended contract so the table's grants read in one place.
grant select, insert on public.distribution_channel_spend to service_role;
grant select          on public.distribution_channel_spend to authenticated;
