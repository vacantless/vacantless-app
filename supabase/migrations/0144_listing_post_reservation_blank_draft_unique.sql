-- ============================================================================
-- 0144_listing_post_reservation_blank_draft_unique
--
-- Distribution hardening #2 (S487b — Codex P3 fold). The per-channel co-pilot
-- "reserve a tracked ?p= link before posting" flow inserts a draft listing_posts
-- row (status='draft', url null) when no tracker exists yet for a (property,
-- portal). A rapid double-submit / concurrent run-launch could pass the in-code
-- reuse check in two requests at once and insert TWO blank drafts; only one is
-- referenced by the eventual run item, leaving an orphaned blank Draft that can
-- surface in the where-posted tracker.
--
-- Fix: a PARTIAL unique index so at most ONE blank reservation draft can exist
-- per (property, portal). The loser of a concurrent insert gets a unique
-- violation and re-selects the winner's row (see startDistributionRun /
-- addRunChannel in app/dashboard/properties/actions.ts).
--
-- Intentionally NARROW: it constrains ONLY blank (url-less) drafts, so it never
-- conflicts with a real posted draft/live row that carries a url (e.g. an A/B
-- "Variant A" draft with its own ad URL) or with multiple live posts on a portal.
-- Verified pre-flight (2026-07-14): zero existing (property, portal) blank-draft
-- duplicates, so the index builds cleanly.
--
-- Reversible: drop index listing_posts_blank_draft_unique.
-- ============================================================================

create unique index if not exists listing_posts_blank_draft_unique
  on public.listing_posts (property_id, portal)
  where status = 'draft' and url is null;
