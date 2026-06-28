-- ===========================================================================
-- 0088 — one active tenancy per property (Codex QA guardrail, 2026-06-28).
--
-- Codex's review found /dashboard/tenancies/new offered a unit (18 Shorncliffe)
-- that already had an ACTIVE tenancy, allowing a double-booking. The app now
-- guards this server-side (createTenancy re-checks property ownership + existing
-- active/upcoming tenancies), and this index is the DB backstop: a unit can hold
-- at most ONE active tenancy at a time.
--
-- Scope note: only `status = 'active'` is constrained — NOT 'upcoming'. A unit in
-- turnover can legitimately have its current ACTIVE lease plus the next tenant's
-- UPCOMING lease at the same time; the app layer still blocks creating a second
-- live tenancy through the form, but the hard DB invariant is the one that must
-- never be violated: two simultaneous *active* leases on one unit.
--
-- Verified before shipping: no property currently has >1 active tenancy, so the
-- unique index builds cleanly.
-- ===========================================================================

create unique index if not exists tenancies_one_active_per_property
  on public.tenancies(property_id)
  where status = 'active';
