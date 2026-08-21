-- S670: make the renter-reply ingest ledger non-erasable by the role that writes it.
--
-- 0219 created public.renter_reply_ingests as a metadata-only ingest ledger and
-- correctly revoked anon and authenticated, but the Supabase project default grants
-- service_role ALL on tables in public, so service_role kept TRUNCATE. Same oversight
-- 0218 fixed on the spend ledger.
--
-- WHY THIS ONE MATTERS MORE THAN 0218. This table is not only an audit trail. It is the
-- live dedupe key and the rate-limiter source for /api/inbound/reply, a PUBLIC inbound
-- webhook. Truncating it does not merely erase history, it re-arms the system: every
-- previously seen message_key becomes new again (replayable) and every org's relay
-- rate limit resets to zero. DELETE was already withheld from service_role, which shows
-- the intent was right; TRUNCATE is a strictly more powerful way to empty the same table
-- and was left behind by the role default.
--
-- SCOPE NOTE, read this before generalising. service_role can TRUNCATE nearly every table
-- in public. This migration deliberately fixes exactly ONE more table, for the reason
-- above. It is NOT a project-wide hardening pass and must not be reported as one.
--
-- UPDATE IS DELIBERATELY KEPT. lib/renter-reply-ingest-server.ts:292 updates status and
-- relay_recipients after a relay completes, so revoking UPDATE here would break the
-- ingest path. Verified by reading the call sites, not assumed.
--
-- Verified safe at apply time [2026-08-21]: 0 rows, 0 user triggers, RLS enabled with 0
-- policies, and there is NO SQL TRUNCATE anywhere in app/, lib/, scripts/ or supabase/ at
-- main 3cabc01 (every "truncate" hit in the tree is a Tailwind class name).
--
-- Applied 2026-08-21 as migration version 20260821114744. Read back after apply:
--   service_role = INSERT, REFERENCES, SELECT, TRIGGER, UPDATE  (TRUNCATE gone, UPDATE kept)
--
-- Reversal, one line, if this ever breaks anything:
--   grant truncate on public.renter_reply_ingests to service_role;

revoke truncate on public.renter_reply_ingests from service_role;

-- Re-affirm the intended contract so the table's grants read in one place.
grant select, insert, update on public.renter_reply_ingests to service_role;
