-- ===========================================================================
-- 0089 — close the public surfaces on already-tenanted units (Codex re-review
-- P1, S371).
--
-- S370 made the lifecycle rail read tenancy truth, but every PUBLIC/SHARE/FEED
-- surface still keyed off properties.status: get_public_listing, the public
-- booking RPCs (book_public_showing / submit_public_lead require status =
-- 'available'), the screening "units" picker (status = 'available'), the
-- syndication feed RPC, and the Rentals list chip + Copy-link. So a unit with an
-- ACTIVE tenancy but status 'available' (e.g. the seeded 18 Shorncliffe) was
-- still publicly Live and bookable.
--
-- The app now flips a unit to 'leased' when a tenancy is created (createTenancy,
-- S371). This migration is the one-time BACKFILL for units that already have an
-- active/upcoming tenancy but are still publicly exposed.
--
-- Guarded the same way as the app write:
--   * only flips from a PUBLICLY-EXPOSED state ('available' or 'paused') — it
--     leaves 'off_market' alone (watchLease's intentionally-private units) and
--     'draft'/'leased' alone (already non-bookable / already correct);
--   * only when the unit actually has an active or upcoming tenancy.
--
-- Idempotent: re-running flips nothing new. A fresh/empty DB is a no-op (no
-- tenancies). Preview the affected rows with the SELECT in the deploy notes
-- before applying to a populated database.
-- ===========================================================================

update public.properties p
set status = 'leased'
where p.status in ('available', 'paused')
  and exists (
    select 1
    from public.tenancies t
    where t.property_id = p.id
      and t.status in ('active', 'upcoming')
  );
