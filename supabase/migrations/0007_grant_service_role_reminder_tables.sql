-- ============================================================================
-- Vacantless — M3 reminders go-live: grant service_role DML on reminder tables
-- ============================================================================
-- The reminder sweep (app/api/cron/reminders) runs as the service_role via
-- lib/supabase/admin.ts. This project has "auto-expose new tables" OFF and never
-- granted DML to service_role, so the sweep hit "permission denied for table
-- showings". Grant the privileges the sweep needs (read across orgs, stamp the
-- showing's reminder_*_sent_at columns, log an outbound message to the timeline).
--
-- NOTE: this file is a BACKFILL — these statements were first applied live via
-- the Supabase connector during the S172 go-live (2026-06-15, version
-- 20260615124047) and the file was not committed at the time. Recovered verbatim
-- from supabase_migrations.schema_migrations so the repo matches the live DB.
-- Idempotent re-grant; safe to re-run. Runs after 0006.
-- ============================================================================

grant select, insert, update, delete on public.showings to service_role;
grant select, insert, update, delete on public.leads to service_role;
grant select, insert, update, delete on public.properties to service_role;
grant select, insert, update, delete on public.messages to service_role;
grant select, update on public.organizations to service_role;
