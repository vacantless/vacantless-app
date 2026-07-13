-- 0143_documents_source_in_app_generated — the N4 vault filing (Slice C, S481)
-- inserts a documents row with source='in_app_generated' (an APP-GENERATED PDF —
-- distinct from an uploaded scan, an in-app EXECUTED lease, or an email/SMS
-- ingest). documents_source_check (0076) predates this value, so the filing
-- insert failed the CHECK and fileN4ToVault created ZERO documents (surfaced in
-- live North Star QA). Extend the allowlist to include 'in_app_generated'.
-- Additive + reversible. Applied to prod via Supabase MCP 2026-07-13.
alter table public.documents drop constraint documents_source_check;
alter table public.documents add constraint documents_source_check
  check (source = any (array['uploaded','in_app_executed','in_app_generated','ingest_email','ingest_sms']));
