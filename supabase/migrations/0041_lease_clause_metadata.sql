-- ============================================================================
-- 0041_lease_clause_metadata — clause-library depth (lease vault #11, slice 6)
--
-- Slice 1 (migration 0039) shipped the clause library + per-clause versioning
-- with the minimum columns. Noam's clause-section review (seed.rtf / seed1.rtf,
-- 2026-06-18) asks for the landlord-facing depth that makes the library usable
-- and Ontario-safe: a visible RISK LEVEL per clause, the JURISDICTION it was
-- written for, and a plain-English NOTE for the landlord. The 15-clause seed and
-- the smart-recommendation logic live in lib/clauses.ts; this migration is the
-- three additive columns those need.
--
-- Purely additive, no data loss:
--   risk_level         — 'standard' | 'caution' | 'legal_review'. Drives the UI
--                        badge + the per-clause caution / legal-review warning.
--                        Defaults 'standard' so every existing row is valid.
--   jurisdiction       — 'ontario' | 'canada' | 'custom'. The legal context the
--                        wording was authored for. Defaults 'ontario' (the only
--                        jurisdiction Vacantless ships seed law for today).
--   notes_for_landlord — optional plain-English explanation shown in the clause
--                        detail ("use this when…"). Nullable.
--
-- Conventions mirror 0039 / 0033: CHECK (not a pg enum) so whitelists extend in
-- one line; defaulted-not-null for the two enumerated columns so the backfill of
-- existing rows is automatic and no row is ever left invalid. No RLS / grant
-- change — the columns ride on the lease_clauses policy + grants already in 0039.
-- `category` stays free text (0039's deliberate choice); the 6 practical
-- categories Noam specified are applied in the seed + grouped in the UI, not
-- constrained here, so an org can still add its own grouping.
-- ============================================================================

alter table public.lease_clauses
  add column if not exists risk_level text not null default 'standard'
    check (risk_level in ('standard', 'caution', 'legal_review'));

alter table public.lease_clauses
  add column if not exists jurisdiction text not null default 'ontario'
    check (jurisdiction in ('ontario', 'canada', 'custom'));

alter table public.lease_clauses
  add column if not exists notes_for_landlord text;
