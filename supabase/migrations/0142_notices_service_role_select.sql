-- 0142_notices_service_role_select — the public N4 lane (Slice C, S481) reads the
-- notices row via the SERVICE-ROLE admin client (the tenant has no session; the
-- per-notice service_token is the only handle). Migration 0140 granted notices
-- CRUD only to `authenticated`, so service_role SELECT was permission-denied and
-- the public /notice/[token] + /notice/[token]/official routes 404'd on every
-- served notice. Grant SELECT (READ-ONLY) to service_role — service_role bypasses
-- RLS, so scoping stays in the route (selects strictly by service_token and
-- requires a served, reconciling snapshot). NO write grant: operator write paths
-- use the authenticated client under RLS. Applied to prod via MCP 2026-07-13.
grant select on public.notices to service_role;
